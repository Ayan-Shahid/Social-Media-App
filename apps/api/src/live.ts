// Live video service (DECISIONS.md D16). Its own process and container, because it's stateful:
// a stream lives in the process that ingests it.
//
//   broadcaster: camera -> MediaRecorder (0.5 s chunks) -> WebSocket /stream/ingest/:id -> ffmpeg stdin
//   ffmpeg:      re-encodes to H.264/AAC, short side <= 720p, 2 s HLS segments, rolling 6-segment playlist
//   viewers:     GET /stream/:id/index.m3u8 and segments, each request checked against RLS (app.can_see)
//
// Latency is a few seconds (HLS), not WebRTC's sub-second; the trade-off is that it's built from the
// same parts as the rest of the app (ffmpeg, HLS, hls.js), works through Cloudflare Tunnel, and needs no
// TURN servers or SFU. Live comments and hearts go over the existing realtime bus (realtime.ts).
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { asUser } from "./db/client.js";
import { resolveSession, SESSION_COOKIE } from "./middleware/session.js";
import { emit } from "./infra/outbox.js";
import { publish } from "./infra/bus.js";
import { redis } from "./infra/redis.js";

const DIR = config.LIVE_DIR;
const SEGMENT = /^(index\.m3u8|seg_\d{5}\.ts)$/;
const ID = /^[0-9a-f-]{36}$/;

type Ingest = { id: string; hostId: string; ffmpeg: ChildProcessWithoutNullStreams; ws: WebSocket; startedAt: number; live: boolean; bytes: number; closing: boolean };
const ingests = new Map<string, Ingest>();

function cookie(header: string | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** "May this user watch this stream?" RLS answers (live_streams_select uses app.can_see). Cached 20 s per pair. */
const access = new Map<string, { ok: boolean; at: number }>();
async function canWatch(userId: string, streamId: string) {
  const k = `${userId}:${streamId}`;
  const hit = access.get(k);
  if (hit && Date.now() - hit.at < 20_000) return hit.ok;
  const r = await asUser(userId, (tx) => tx.execute(sql`select 1 from live_streams where id = ${streamId}`));
  const ok = (r.rowCount ?? 0) > 0;
  access.set(k, { ok, at: Date.now() });
  if (access.size > 50_000) access.clear();
  return ok;
}

const setStatus = (hostId: string, id: string, status: "live" | "ended") => asUser(hostId, async (tx) => {
  if (status === "live") {
    const r = await tx.execute(sql`update live_streams set status = 'live', started_at = now() where id = ${id} and status = 'starting'`);
    // "x started a live video" to followers, via the outbox + worker, like every other notification.
    if (r.rowCount) await emit(tx, hostId, "live.started", { liveId: id, hostId });
  } else {
    await tx.execute(sql`update live_streams set status = 'ended', ended_at = now() where id = ${id} and status <> 'ended'`);
  }
});

function startIngest(ws: WebSocket, id: string, hostId: string) {
  const out = path.join(DIR, id);
  fs.mkdirSync(out, { recursive: true });
  // Short side capped at 720 px, constant 30 fps, keyframe every 2 s so every segment starts cleanly.
  const scale = "scale='trunc(min(1,720/min(iw,ih))*iw/2)*2':'trunc(min(1,720/min(iw,ih))*ih/2)*2'";
  const ffmpeg = spawn(config.FFMPEG_PATH, [
    "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", "pipe:0",
    "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale, "-r", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-b:v", "1800k", "-maxrate", "2200k", "-bufsize", "4000k",
    "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "2",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments+independent_segments+temp_file",
    "-hls_segment_filename", path.join(out, "seg_%05d.ts"), path.join(out, "index.m3u8"),
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const s: Ingest = { id, hostId, ffmpeg, ws, startedAt: Date.now(), live: false, bytes: 0, closing: false };
  ingests.set(id, s);
  let errors = "";
  ffmpeg.stderr.on("data", (d) => { if (errors.length < 4000) errors += d; });
  ffmpeg.stdin.on("error", () => {}); // EPIPE if ffmpeg died; handled by 'exit'

  // The stream is "live" once the first segment is listed: only then do followers get notified.
  const watch = setInterval(() => {
    if (s.live) return;
    if (fs.existsSync(path.join(out, "index.m3u8"))) {
      s.live = true;
      setStatus(hostId, id, "live").catch((e) => console.error("[live] status", e));
      ws.send(JSON.stringify({ type: "live" }));
    }
  }, 300);
  // Liveness for crash recovery: if this process dies, the key expires and a maintenance job ends the stream.
  const alive = setInterval(() => { redis.set(`live:${id}:alive`, "1", "EX", 15).catch(() => {}); }, 5000);
  redis.set(`live:${id}:alive`, "1", "EX", 15).catch(() => {});
  const limit = setTimeout(() => stop(s, "Time limit reached."), config.MAX_LIVE_MINUTES * 60_000);

  ws.on("message", (data: Buffer, isBinary) => {
    if (!isBinary) { if (String(data) === "end") stop(s, null); return; }
    s.bytes += data.length;
    // Backpressure: if ffmpeg can't keep up (CPU), buffering forever would eat memory. Drop the stream instead.
    if (ffmpeg.stdin.writableLength > 16 * 1024 * 1024) return stop(s, "The connection or server is too slow for live video.");
    ffmpeg.stdin.write(data);
  });
  ws.on("close", () => stop(s, null));
  ws.on("error", () => stop(s, null));

  ffmpeg.on("exit", (code) => {
    clearInterval(watch); clearInterval(alive); clearTimeout(limit);
    ingests.delete(id);
    if (code && !s.closing) console.error(`[live] ffmpeg ${id} exited ${code}: ${errors.slice(-500)}`);
    redis.del(`live:${id}:alive`).catch(() => {});
    setStatus(hostId, id, "ended").catch(() => {});
    publish([`#live:${id}`], "live:ended", { id }).catch(() => {});
    if (ws.readyState === ws.OPEN) ws.close(1000, "ended");
    // Keep the last segments a little while so viewers reach the end of the playlist, then delete.
    setTimeout(() => fsp.rm(out, { recursive: true, force: true }).catch(() => {}), 120_000).unref();
  });
}

function stop(s: Ingest, reason: string | null) {
  if (s.closing) return;
  s.closing = true;
  if (reason && s.ws.readyState === s.ws.OPEN) s.ws.send(JSON.stringify({ type: "error", message: reason }));
  s.ffmpeg.stdin.end(); // ffmpeg flushes the last segment and writes #EXT-X-ENDLIST
  setTimeout(() => s.ffmpeg.kill("SIGKILL"), 8000).unref();
}

export function createLiveServer() {
  const allowedOrigin = new URL(config.APP_ORIGIN).origin;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/stream/health") return void res.end(JSON.stringify({ ok: true, streams: ingests.size }));
    const m = /^\/stream\/([0-9a-f-]{36})\/([^/]+)$/.exec(url.pathname);
    if (req.method !== "GET" || !m || !SEGMENT.test(m[2]!)) { res.statusCode = 404; return void res.end(); }
    const session = await resolveSession(cookie(req.headers.cookie, SESSION_COOKIE)).catch(() => null);
    if (!session) { res.statusCode = 401; return void res.end(); }
    if (!(await canWatch(session.userId, m[1]!).catch(() => false))) { res.statusCode = 404; return void res.end(); }
    const file = path.join(DIR, m[1]!, m[2]!);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.statusCode = 404; return void res.end(); }
      const playlist = m[2]!.endsWith(".m3u8");
      res.setHeader("Content-Type", playlist ? "application/vnd.apple.mpegurl" : "video/mp2t");
      // The playlist changes every 2 s; segments never change.
      res.setHeader("Cache-Control", playlist ? "no-cache, no-store" : "private, max-age=60, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Length", st.size);
      fs.createReadStream(file).pipe(res);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on("upgrade", async (req, socket, head) => {
    const refuse = (code: number) => { socket.write(`HTTP/1.1 ${code} No\r\n\r\n`); socket.destroy(); };
    const m = /^\/stream\/ingest\/([0-9a-f-]{36})$/.exec(new URL(req.url ?? "/", "http://x").pathname);
    if (!m || !ID.test(m[1]!)) return refuse(404);
    if (req.headers.origin !== allowedOrigin) return refuse(403); // cross-site WebSocket hijacking
    const session = await resolveSession(cookie(req.headers.cookie, SESSION_COOKIE)).catch(() => null);
    if (!session) return refuse(401);
    const id = m[1]!;
    // Only the host, only for their own unfinished stream, and only one ingest at a time.
    const r = await asUser(session.userId, (tx) => tx.execute<{ host_id: string; status: string }>(sql`select host_id, status from live_streams where id = ${id}`)).catch(() => null);
    const row = r?.rows[0];
    if (!row || row.host_id !== session.userId || row.status === "ended" || ingests.has(id)) return refuse(409);
    wss.handleUpgrade(req, socket, head, (ws) => startIngest(ws, id, session.userId));
  });
  return server;
}

const isMain = process.argv[1]?.endsWith("live.js") || process.argv[1]?.endsWith("live.ts");
if (isMain) {
  fs.mkdirSync(DIR, { recursive: true });
  const server = createLiveServer();
  server.listen(config.LIVE_PORT, () => console.log(`Glimpse live ${config.INSTANCE_ID} on :${config.LIVE_PORT}`));
  const shutdown = () => {
    for (const s of ingests.values()) stop(s, "The live service is restarting.");
    server.close();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export const activeIngests = () => ingests.size;
