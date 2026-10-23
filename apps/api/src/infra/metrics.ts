// Prometheus metrics (DECISIONS.md D12). Scraped from /api/internal/metrics, also shown on the Ops page.
import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "glimpse_" });

export const httpDuration = new client.Histogram({
  name: "glimpse_http_request_duration_seconds", help: "HTTP request duration",
  labelNames: ["method", "route", "status"], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [registry],
});
export const cacheHits = new client.Counter({ name: "glimpse_cache_hits_total", help: "Cache hits", labelNames: ["cache"], registers: [registry] });
export const cacheMisses = new client.Counter({ name: "glimpse_cache_misses_total", help: "Cache misses", labelNames: ["cache"], registers: [registry] });
export const dbLoads = new client.Counter({ name: "glimpse_cache_db_loads_total", help: "Database loads caused by cache misses", labelNames: ["cache"], registers: [registry] });
export const fanoutWrites = new client.Counter({ name: "glimpse_fanout_writes_total", help: "Timeline insertions by fan-out", registers: [registry] });
export const outboxRelayed = new client.Counter({ name: "glimpse_outbox_relayed_total", help: "Outbox events moved to the queue", registers: [registry] });
export const rateLimited = new client.Counter({ name: "glimpse_rate_limited_total", help: "Requests refused by a rate limit", labelNames: ["rule"], registers: [registry] });
export const jobsProcessed = new client.Counter({ name: "glimpse_jobs_total", help: "Background jobs", labelNames: ["queue", "result"], registers: [registry] });

/** Reads a counter's current values, for the Ops page. */
export async function counterValues(c: client.Counter<string>) {
  const m = await c.get();
  return Object.fromEntries(m.values.map((v) => [Object.values(v.labels).join(",") || "all", v.value]));
}
