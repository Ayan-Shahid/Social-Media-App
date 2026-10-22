"use client";
// Live view of the system's moving parts. Each refresh may be answered by a different API
// instance (round-robin behind Caddy), which is visible in the "served by" history.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { Empty, PageTitle, Spinner } from "@/components/ui";

interface Stats {
  instance: string; uptimeSeconds: number; connectionsHere: number; onlineUsers: number;
  caches: { name: string; hits: number; misses: number; dbLoads: number; hitRate: number | null }[];
  queues: Record<string, Record<string, number>>; worker: Record<string, number>;
  redisMemory: string | null; fanoutThreshold: number;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div data-surface className="rounded-xl p-4">
      <p className="label">{label}</p>
      <p className="display mt-1 text-[28px] leading-none tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-graphite">{sub}</p>}
    </div>
  );
}

export default function OpsPage() {
  const { isAdmin } = useSession();
  const { instance: socketInstance } = useRealtime();
  const q = useQuery({ queryKey: ["ops"], queryFn: () => api<Stats>("/api/ops/stats"), refetchInterval: 2000, enabled: isAdmin });
  const [servedBy, setServedBy] = useState<string[]>([]);
  useEffect(() => { if (q.data) setServedBy((s) => [...s.slice(-11), q.data.instance]); }, [q.data, q.dataUpdatedAt]);

  if (!isAdmin) return <Empty title="Admins only">Add your username to ADMIN_USERNAMES to see this page.</Empty>;
  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return <Empty title="Stats unavailable" />;
  const s = q.data;

  return (
    <div className="mx-auto max-w-[980px] space-y-8">
      <PageTitle right={<a href="/admin/queues" target="_blank" rel="noreferrer" className="btn btn-line btn-sm">Queue dashboard</a>}>System</PageTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Served by" value={s.instance} sub={<>Your socket: {socketInstance ?? "…"}</>} />
        <Tile label="Online users" value={s.onlineUsers} sub="Shared across instances (Redis)" />
        <Tile label="Sockets here" value={s.connectionsHere} sub={`Up ${Math.floor(s.uptimeSeconds / 60)} min`} />
        <Tile label="Redis cache memory" value={s.redisMemory ?? "—"} sub={`Fan-out pull above ${s.fanoutThreshold} followers`} />
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Load balancing</h2>
        <p className="mb-3 text-[13px] text-graphite">Which API instance answered the last few refreshes. Counters below are per instance.</p>
        <div className="flex flex-wrap gap-1.5">{servedBy.map((x, i) => <span key={i} className="chip font-mono">{x}</span>)}</div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Caches</h2>
        <div data-surface className="overflow-x-auto rounded-xl">
          <table className="w-full text-[14px]">
            <thead className="text-left text-[12px] text-graphite"><tr><th className="p-3">Cache</th><th className="p-3 text-right">Hits</th><th className="p-3 text-right">Misses</th><th className="p-3 text-right">DB loads</th><th className="p-3 text-right">Hit rate</th></tr></thead>
            <tbody className="divide-y divide-rule tabular-nums">
              {s.caches.length === 0 && <tr><td className="p-3 text-graphite" colSpan={5}>No traffic yet on this instance.</td></tr>}
              {s.caches.map((c) => (
                <tr key={c.name}><td className="p-3 font-mono">{c.name}</td><td className="p-3 text-right">{c.hits}</td><td className="p-3 text-right">{c.misses}</td><td className="p-3 text-right">{c.dbLoads}</td>
                  <td className="p-3 text-right">{c.hitRate === null ? "—" : `${c.hitRate}%`}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-graphite">DB loads lower than misses means single-flight worked: concurrent misses waited for one load instead of all hitting Postgres.</p>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Queues</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(s.queues).map(([name, c]) => (
            <div key={name} data-surface className="rounded-xl p-4">
              <p className="font-mono font-semibold">{name}</p>
              <dl className="mt-2 grid grid-cols-5 gap-2 text-center text-[12px]">
                {(["waiting", "active", "delayed", "failed", "completed"] as const).map((k) => (
                  <div key={k}><dd className="text-[18px] font-semibold tabular-nums">{c[k] ?? 0}</dd><dt className="text-graphite">{k}</dt></div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-graphite">Worker: {s.worker[`${name}_ok`] ?? 0} done, {s.worker[`${name}_failed`] ?? 0} failed</p>
            </div>
          ))}
        </div>
        {s.worker.fanout_writes !== undefined && <p className="mt-2 text-[12px] text-graphite">Fan-out has written {s.worker.fanout_writes} feed entries.</p>}
      </section>
    </div>
  );
}
