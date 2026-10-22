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
  MEDIA_DIR: z.string().default("./data/media"),
  SESSION_DAYS: z.coerce.number().default(30),
  MAX_IMAGE_MB: z.coerce.number().default(10),
  MAX_VIDEO_MB: z.coerce.number().default(60),
  MAX_VIDEO_SECONDS: z.coerce.number().default(60),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TRUST_PROXY: z.coerce.number().default(1),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === "production";
export const secureCookies = config.APP_ORIGIN.startsWith("https://");
