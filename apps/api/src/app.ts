import express from "express";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { config, isProd } from "./config.js";
import { errorHandler } from "./lib/http.js";
import { sessionMiddleware } from "./middleware/session.js";
import { csrfMiddleware } from "./middleware/csrf.js";
import { limit } from "./lib/limits.js";
import { httpDuration } from "./infra/metrics.js";
import { queue, QUEUES } from "./infra/queues.js";
import { authRouter } from "./routes/auth.js";
import { followRequestsRouter, usersRouter } from "./routes/users.js";
import { commentsRouter, postsRouter, tagsRouter } from "./routes/posts.js";
import { mediaRouter } from "./routes/media.js";
import { conversationsRouter, keysRouter } from "./routes/conversations.js";
import { collectionsRouter } from "./routes/collections.js";
import { notificationsRouter } from "./routes/notifications.js";
import { storiesRouter } from "./routes/stories.js";
import { liveRouter } from "./routes/live.js";
import { publicRouter } from "./routes/public.js";
import { internalRouter, opsRouter, requireAdmin } from "./routes/ops.js";

const adminOnlyPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admins only · Glimpse</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#eceef1;color:#15171c}
@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e9ebef}}main{text-align:center;padding:24px}b{display:block;font-size:13px;letter-spacing:.12em;color:#d2691e}
h1{margin:.3em 0;font-size:22px}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:999px;background:currentColor}a span{color:#eceef1}@media (prefers-color-scheme:dark){a span{color:#0f1115}}</style></head>
<body><main><b>403</b><h1>Admins only</h1><p>The queue dashboard is for accounts listed in ADMIN_USERNAMES.</p><a href="/"><span>Back to Glimpse</span></a></main></body></html>`;

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY); // behind Caddy / Cloudflare: real client IP for rate limits

  // Every request gets a short id: in the log line, in an X-Request-Id header, and in the body of a 500,
  // so "Error reference 7f3a9c" on screen can be found in the server log.
  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id = incoming && /^[A-Za-z0-9-]{6,64}$/.test(incoming) ? incoming : randomBytes(6).toString("hex");
    res.setHeader("X-Request-Id", String(req.id));
    next();
  });

  if (config.NODE_ENV !== "test") {
    app.use(pinoHttp({
      genReqId: (req) => req.id as string,
      level: isProd ? "info" : "debug",
      redact: ["req.headers.cookie", "req.headers['x-csrf-token']", 'res.headers["set-cookie"]'],
      autoLogging: { ignore: (req) => req.url === "/api/health" || req.url === "/api/internal/metrics" },
      customProps: () => ({ instance: config.INSTANCE_ID }),
    }));
  }

  // Request timing for Prometheus, labelled by route pattern (not raw URL, to keep labels bounded).
  app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || "other", status: String(res.statusCode) }));
    next();
  });
  app.use((_req, res, next) => { res.setHeader("X-Served-By", config.INSTANCE_ID); next(); });

  app.get("/api/health", (_req, res) => { res.json({ ok: true, instance: config.INSTANCE_ID }); });
  app.use("/api/internal", internalRouter);

  // Queue dashboard (admins only). Mounted before the strict API headers: it's an HTML app.
  const board = new ExpressAdapter();
  board.setBasePath("/admin/queues");
  createBullBoard({ queues: QUEUES.map((q) => new BullMQAdapter(queue(q))), serverAdapter: board });
  // Not an API: a person opened it in the browser. Not signed in -> log in first; signed in but not
  // an admin -> a readable page, not JSON.
  app.use("/admin/queues", cookieParser(), sessionMiddleware, (req, res, next) => {
    if (!req.userId) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    requireAdmin(req, res, next).catch(() => res.status(403).type("html").send(adminOnlyPage));
  },
    helmet({ contentSecurityPolicy: false, frameguard: { action: "deny" } }), board.getRouter());

  // The API only returns JSON, so it gets the strictest headers: no scripts, no framing.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }));

  // Media files are served from object storage by Caddy (/media/* -> the public bucket), not by the API.

  app.use(cookieParser());
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", sessionMiddleware, csrfMiddleware);
  // Rate limits (DECISIONS.md D20). Sign-in routes have their own, stricter ones.
  const readLimit = limit("read"), writeLimit = limit("write");
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    return (req.method === "GET" || req.method === "HEAD" ? readLimit : writeLimit)(req, res, next);
  });

  app.use("/api/public", publicRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/follow-requests", followRequestsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/comments", commentsRouter);
  app.use("/api/tags", tagsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/keys", keysRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/stories", storiesRouter);
  app.use("/api/live", liveRouter);
  app.use("/api/ops", opsRouter);
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found." }); });

  app.use(errorHandler);
  return app;
}
