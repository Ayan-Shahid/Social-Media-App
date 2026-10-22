import http from "node:http";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { anonymous, pool } from "./db/client.js";
import { attachRealtime, closeRealtime } from "./realtime.js";
import { redis } from "./infra/redis.js";
import { closeQueues } from "./infra/queues.js";
import { ensureBuckets } from "./infra/storage.js";

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);
// Buckets must exist before the first upload; retried in the background if storage is still starting.
const buckets = () => ensureBuckets().catch((e) => { console.error("storage not ready, retrying:", (e as Error).message); setTimeout(buckets, 3000); });
buckets();

server.listen(config.PORT, () => console.log(`Glimpse API ${config.INSTANCE_ID} on :${config.PORT}`));

// Hourly housekeeping: expired sessions and old idempotency records.
const purge = () => anonymous((tx) => tx.execute(sql`select auth.purge_expired()`)).catch((e) => console.error("purge failed", e));
setInterval(purge, 60 * 60_000).unref();
purge();

// Graceful shutdown: stop taking connections, finish in-flight requests, then close pools.
const shutdown = () => {
  server.close(async () => {
    await closeRealtime().catch(() => {});
    await closeQueues().catch(() => {});
    redis.disconnect();
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
