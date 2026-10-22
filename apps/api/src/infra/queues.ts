// BullMQ queues (DECISIONS.md D2). Every job retries 5 times with exponential backoff; jobs that
// still fail stay in the failed set (our dead-letter queue), visible and retryable in /admin/queues.
import { Queue, type JobsOptions } from "bullmq";
import { queueConnection } from "./redis.js";

export const QUEUES = ["media", "fanout", "notify", "maintenance"] as const;
export type QueueName = (typeof QUEUES)[number];

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600, count: 2000 },
  removeOnFail: false,
};

let conn: ReturnType<typeof queueConnection> | null = null;
const cache = new Map<QueueName, Queue>();

export function queue(name: QueueName) {
  conn ??= queueConnection();
  let q = cache.get(name);
  if (!q) { q = new Queue(name, { connection: conn, defaultJobOptions }); cache.set(name, q); }
  return q;
}

export async function queueCounts() {
  const out: Record<string, Record<string, number>> = {};
  for (const n of QUEUES) out[n] = await queue(n).getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return out;
}

export async function closeQueues() {
  await Promise.all([...cache.values()].map((q) => q.close()));
  cache.clear();
  await conn?.quit().catch(() => {});
  conn = null;
}
