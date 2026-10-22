import { z } from "zod";

// All settings come from environment variables (see .env.example at the repo root).
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  // App role: no superuser, no RLS bypass. Used for every request.
  DATABASE_URL: z.string().min(1),
  // Owner role: used only by the migration runner.
  MIGRATION_DATABASE_URL: z.string().optional(),
  APP_DB_ROLE: z.string().default("glimpse_app"),
  APP_DB_PASSWORD: z.string().optional(),
  // Public address of the site, e.g. https://glimpse.example.com. Used for the CSRF origin check and cookies.
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Object storage (S3 API). S3_PUBLIC_ENDPOINT is what browsers use for signed uploads (APP_ORIGIN behind Caddy).
  S3_ENDPOINT: z.string().url().default("http://localhost:8333"),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default("glimpse"),
  S3_SECRET_KEY: z.string().default("glimpse-dev-secret"),
  S3_BUCKET_UPLOADS: z.string().default("uploads"),
  S3_BUCKET_MEDIA: z.string().default("media"),
  SESSION_DAYS: z.coerce.number().default(30),
  MAX_IMAGE_MB: z.coerce.number().default(10),
  MAX_VIDEO_MB: z.coerce.number().default(60),
  MAX_VIDEO_SECONDS: z.coerce.number().default(60),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  // Live video service (DECISIONS.md D16)
  LIVE_PORT: z.coerce.number().default(4100),
  LIVE_DIR: z.string().default("/tmp/glimpse-live"),
  MAX_LIVE_MINUTES: z.coerce.number().default(60),
  TRUST_PROXY: z.coerce.number().default(1),
  // Background workers connect as their own role (DECISIONS.md D13).
  WORKER_DATABASE_URL: z.string().optional(),
  // D1: cache (evictable) and queue (durable) live in separate Redis instances.
  REDIS_CACHE_URL: z.string().default("redis://localhost:6380"),
  REDIS_QUEUE_URL: z.string().default("redis://localhost:6381"),
  // D3: authors with at least this many followers are pulled at read time instead of pushed.
  FANOUT_THRESHOLD: z.coerce.number().default(10_000),
  FEED_MAX_ITEMS: z.coerce.number().default(800),
  INSTANCE_ID: z.string().default(process.env.HOSTNAME ?? "api-local"),
  ADMIN_USERNAMES: z.string().default(""),
  // Benchmarks only (docs/v2/BENCHMARKS.md): skip the read-through caches to measure their effect.
  CACHE_BYPASS: z.stringbool().default(false),
  // Sign in with Google (OIDC). Leave the client id empty to hide the button.
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_ISSUER: z.string().default("https://accounts.google.com"),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === "production";
export const secureCookies = config.APP_ORIGIN.startsWith("https://");

export const adminUsernames = new Set(config.ADMIN_USERNAMES.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
