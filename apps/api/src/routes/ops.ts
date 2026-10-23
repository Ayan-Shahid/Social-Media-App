// Ops: live system numbers for admins (DECISIONS.md D12). Also the Prometheus endpoint.
import { Router, type Request, type Response, type NextFunction } from "express";
import { config, adminUsernames } from "../config.js";
import { counterValues, cacheHits, cacheMisses, dbLoads, registry, rateLimited } from "../infra/metrics.js";
import { queueCounts } from "../infra/queues.js";
import { redis, keys } from "../infra/redis.js";
import { forbidden, requireUser } from "../lib/http.js";
import { localConnections } from "../realtime.js";
import { asUser } from "../db/client.js";
import { getUsers } from "../services/hydrate.js";

export const opsRouter = Router();
export const internalRouter = Router();

export async function isAdmin(userId: string | undefined) {
  if (!userId || !adminUsernames.size) return false;
  const u = (await asUser(userId, (tx) => getUsers(tx, [userId]))).get(userId);
  return !!u && adminUsernames.has(u.username.toLowerCase());
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  requireUser(req);
  if (!(await isAdmin(req.userId))) throw forbidden("Admins only.");
  next();
}

opsRouter.get("/stats", requireAdmin, async (_req, res) => {
  const [hits, misses, loads, queues, info, worker, online, limited, reconcile] = await Promise.all([
    counterValues(cacheHits), counterValues(cacheMisses), counterValues(dbLoads), queueCounts(),
    redis.info("memory"), redis.hgetall("stats:worker"),
    redis.zcount(keys.presence, Date.now() - 50_000, "+inf"),
    counterValues(rateLimited), redis.get("ops:storage-reconcile"),
  ]);
  const caches = Object.keys({ ...hits, ...misses }).map((name) => {
    const h = hits[name] ?? 0, m = misses[name] ?? 0;
    return { name, hits: h, misses: m, dbLoads: loads[name] ?? 0, hitRate: h + m ? Math.round((h / (h + m)) * 1000) / 10 : null };
  });
  res.json({
    instance: config.INSTANCE_ID,
    uptimeSeconds: Math.round(process.uptime()),
    connectionsHere: localConnections(),
    onlineUsers: online,
    caches, queues, worker: Object.fromEntries(Object.entries(worker).map(([k, v]) => [k, Number(v)])),
    redisMemory: /used_memory_human:(\S+)/.exec(info)?.[1] ?? null,
    fanoutThreshold: config.FANOUT_THRESHOLD,
    rateLimited: limited, // this instance, since it started
    storageReconcile: reconcile ? JSON.parse(reconcile) : null,
  });
});

/** Prometheus scrape endpoint. Blocked at the proxy: only reachable inside the Docker network. */
internalRouter.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});
