// Background worker process. Never serves HTTP. Runs:
//  - the outbox relay (Postgres -> BullMQ)
//  - a BullMQ worker per queue
//  - repeatable maintenance jobs
// Scale by running more worker containers; the relay and queues are safe with several.
import { Worker, type Job, type Processor } from "bullmq";
import { config } from "./config.js";
import { queueConnection, redis } from "./infra/redis.js";
import { queue, closeQueues, type QueueName } from "./infra/queues.js";
import { startRelay } from "./infra/outbox.js";
import { ensureBuckets } from "./infra/storage.js";
import { jobsProcessed } from "./infra/metrics.js";
import { closeWorkerPool } from "./db/worker-pool.js";
import { mediaJob, markFailed } from "./jobs/media.js";
import { fanoutJob } from "./jobs/fanout.js";
import { notifyJob } from "./jobs/notify.js";
import { maintenanceJob } from "./jobs/maintenance.js";

export function startWorkers(opts: { relay?: boolean } = {}) {
  const connection = queueConnection();
  const make = (name: QueueName, fn: Processor, concurrency: number) => {
    const w = new Worker(name, fn, { connection, concurrency });
    w.on("completed", () => { jobsProcessed.inc({ queue: name, result: "ok" }); redis.hincrby("stats:worker", `${name}_ok`, 1).catch(() => {}); });
    w.on("failed", (job: Job | undefined, err) => {
      jobsProcessed.inc({ queue: name, result: "failed" });
      redis.hincrby("stats:worker", `${name}_failed`, 1).catch(() => {});
      console.error(`[${name}] job ${job?.id} (${job?.name}) failed attempt ${job?.attemptsMade}: ${err.message}`);
      // Out of retries: a media item must not stay "processing" forever.
      if (name === "media" && job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        markFailed(job.data.mediaId, job.data.ownerId, "Processing failed. Please try another file.").catch(() => {});
      }
    });
    return w;
  };
  // Media: video encoding uses every core, so one at a time per worker (D8). Scale with more workers.
  const workers = [
    make("media", mediaJob as Processor, 1),
    make("fanout", fanoutJob as Processor, 5),
    make("notify", notifyJob as Processor, 10),
    make("maintenance", maintenanceJob as Processor, 1),
  ];
  const relay = opts.relay === false ? null : startRelay(config.WORKER_DATABASE_URL ?? config.DATABASE_URL, { intervalMs: 1000 });
  return {
    workers, relay,
    async close() {
      await relay?.stop();
      await Promise.all(workers.map((w) => w.close()));
      await connection.quit().catch(() => {});
    },
  };
}

async function scheduleMaintenance() {
  const q = queue("maintenance");
  await q.upsertJobScheduler("stories.expire", { every: 10 * 60_000 }, { name: "stories.expire" });
  await q.upsertJobScheduler("outbox.purge", { every: 60 * 60_000 }, { name: "outbox.purge" });
  await q.upsertJobScheduler("media.abandoned", { every: 60 * 60_000 }, { name: "media.abandoned" });
  await q.upsertJobScheduler("live.reap", { every: 60_000 }, { name: "live.reap" });
}

const isMain = process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.ts");
if (isMain) {
  const buckets = () => ensureBuckets().catch((e) => { console.error("storage not ready, retrying:", (e as Error).message); setTimeout(buckets, 3000); });
  buckets();
  const w = startWorkers();
  scheduleMaintenance().catch((e) => console.error("schedule failed", e));
  console.log(`Glimpse worker ${config.INSTANCE_ID} started`);
  const shutdown = async () => {
    // Graceful: finish the current jobs, then exit. Unfinished jobs return to the queue.
    await w.close(); await closeQueues(); await closeWorkerPool(); redis.disconnect(); process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
