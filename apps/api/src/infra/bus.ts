// Realtime event bus on a Redis Stream (DECISIONS.md D11).
//
// Any process (API instance or worker) publishes "send this event to these users". Every API
// instance reads the stream and delivers to the sockets connected to IT. A Stream (unlike plain
// pub/sub) remembers recent entries, so an instance that loses Redis for a moment continues from
// the last entry it saw instead of silently missing events.
import { redis, keys, newBlockingClient } from "./redis.js";

export interface BusEvent { to: string[]; event: string; payload: unknown }

export async function publish(to: string[], event: string, payload: unknown) {
  if (!to.length) return;
  await redis.xadd(keys.realtime, "MAXLEN", "~", "10000", "*", "d", JSON.stringify({ to: [...new Set(to)], event, payload }));
}

export function subscribe(onEvent: (e: BusEvent) => void) {
  const client = newBlockingClient();
  let lastId = "$"; // only new events from now on
  let stopped = false;

  (async () => {
    while (!stopped) {
      try {
        const res = await client.xread("COUNT", 200, "BLOCK", 5000, "STREAMS", keys.realtime, lastId);
        if (!res) continue;
        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            lastId = id;
            const raw = fields[1];
            if (raw) { try { onEvent(JSON.parse(raw)); } catch { /* ignore malformed */ } }
          }
        }
      } catch (e) {
        if (stopped) break;
        console.error("[bus] read failed, retrying", (e as Error).message);
        await new Promise((r) => setTimeout(r, 1000)); // keeps lastId: resumes where it left off
      }
    }
  })();

  return () => { stopped = true; client.disconnect(); };
}
