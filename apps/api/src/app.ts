import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import path from "node:path";
import { config, isProd } from "./config.js";
import { errorHandler } from "./lib/http.js";
import { sessionMiddleware } from "./middleware/session.js";
import { csrfMiddleware } from "./middleware/csrf.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { commentsRouter, postsRouter } from "./routes/posts.js";
import { mediaRouter } from "./routes/media.js";
import { conversationsRouter, keysRouter } from "./routes/conversations.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY); // behind Caddy / Cloudflare: use the real client IP for rate limits

  if (config.NODE_ENV !== "test") {
    app.use(pinoHttp({
      level: isProd ? "info" : "debug",
      redact: ["req.headers.cookie", "req.headers['x-csrf-token']", 'res.headers["set-cookie"]'],
      autoLogging: { ignore: (req) => req.url === "/api/health" },
    }));
  }

  // The API only returns JSON, so it gets the strictest headers: no scripts, no framing.
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });

  // Uploaded media: random file names, fixed types, never sniffed or run as a page.
  app.use("/media", express.static(path.resolve(config.MEDIA_DIR), {
    index: false, dotfiles: "deny", fallthrough: false, immutable: true, maxAge: "365d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Content-Disposition", "inline");
    },
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", sessionMiddleware, csrfMiddleware);

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/comments", commentsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/keys", keysRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found." }); });

  app.use(errorHandler);
  return app;
}
