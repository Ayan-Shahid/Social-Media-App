import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { config, isProd } from "./config.js";
import { errorHandler } from "./lib/http.js";
import { sessionMiddleware } from "./middleware/session.js";
import { csrfMiddleware } from "./middleware/csrf.js";
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
import { internalRouter, opsRouter, requireAdmin } from "./routes/ops.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY); // behind Caddy / Cloudflare: real client IP for rate limits

  if (config.NODE_ENV !== "test") {
    app.use(pinoHttp({
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
  app.use("/admin/queues", cookieParser(), sessionMiddleware, (req, res, next) => requireAdmin(req, res, next).catch(next),
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
