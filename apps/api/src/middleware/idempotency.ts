// Idempotency keys for "create" actions (new post, comment, message, upload).
// The browser sends a unique Idempotency-Key per user action. If the same key arrives again
// (double click, retry after a dropped connection), we return the first response instead of
// doing the action twice.
//  - same key, same request, finished  -> replay the stored response
//  - same key, still running           -> 409, try again shortly
//  - same key, DIFFERENT request body  -> 422, keys can't be reused for other actions
import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { asUser } from "../db/client.js";
import { idempotencyKeys } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export function idempotent(req: Request, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "Please log in." });
  const key = req.get("idempotency-key");
  if (!key || !KEY_RE.test(key)) return res.status(400).json({ error: "Missing or invalid Idempotency-Key header." });
  // Files are hashed by content so a retried upload matches the original.
  const file = (req as Request & { file?: { buffer: Buffer } }).file;
  const requestHash = sha256(JSON.stringify([req.method, req.baseUrl + req.path, req.body ?? null, file ? sha256(file.buffer.toString("base64")) : null]));

  (async () => {
    const inserted = await asUser(userId, (tx) =>
      tx.insert(idempotencyKeys).values({ userId, key, requestHash, status: "in_progress" }).onConflictDoNothing().returning(),
    );
    if (!inserted.length) {
      const [prev] = await asUser(userId, (tx) =>
        tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))),
      );
      if (!prev) return res.status(409).json({ error: "Please retry." });
      if (prev.requestHash !== requestHash) return res.status(422).json({ error: "This Idempotency-Key was already used for a different request." });
      if (prev.status !== "done") return res.status(409).json({ error: "This action is still being processed." });
      res.setHeader("Idempotent-Replayed", "true");
      return res.status(prev.responseStatus ?? 200).json(prev.responseBody);
    }

    // Capture the response so it can be replayed later.
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      const save = status < 500
        ? asUser(userId, (tx) => tx.update(idempotencyKeys).set({ status: "done", responseStatus: status, responseBody: body as object })
            .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))))
        // Server error: forget the key so a retry can actually run again.
        : asUser(userId, (tx) => tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))));
      save.catch((err) => req.log?.error({ err }, "idempotency save failed")).finally(() => json(body));
      return res;
    };
    next();
  })().catch(next);
}
