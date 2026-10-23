import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

export class HttpError extends Error {
  /** `extra` is merged into the JSON body (e.g. { captchaRequired: true }). */
  constructor(public status: number, message: string, public fields?: Record<string, string>, public extra?: Record<string, unknown>) { super(message); }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields);
export const unauthorized = () => new HttpError(401, "Please log in.");
export const forbidden = (m = "Not allowed.") => new HttpError(403, m);
export const notFound = (m = "Not found.") => new HttpError(404, m);

export function parse<T extends z.ZodType>(s: T, data: unknown): z.infer<T> {
  const r = s.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
  throw badRequest("Please check the highlighted fields.", fields);
}

export function requireUser(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ ...err.extra, error: err.message, fields: err.fields });
  const e = err as { code?: string; type?: string; status?: number };
  if (e?.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  // Errors from Express itself (e.g. a blocked "../" path) carry their own 4xx status.
  if (typeof e?.status === "number" && e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: "Bad request." });
  // RLS / permission denied. Drizzle wraps driver errors, so the SQLSTATE may be on `cause`.
  const code = e?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "42501") return res.status(403).json({ error: "Not allowed." });
  req.log?.error({ err }, "unhandled error");
  return res.status(500).json({ error: "Something went wrong." });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId?: string; sessionTokenHash?: string }
  }
}
