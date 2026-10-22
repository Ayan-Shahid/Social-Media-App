// Live video (DECISIONS.md D16): a real stream through the real live service and ffmpeg.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import WebSocket from "ws";
import { io as ioc, type Socket } from "socket.io-client";
import { Client, ORIGIN, key, resetAll, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let host: Client, fan: Client, stranger: Client;
let liveServer: http.Server, apiServer: http.Server;
let LIVE = "", API = "";

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  [host, fan, stranger] = await Promise.all(["host", "fan", "stranger"].map(async (u) => (await new Client(app).init()).register(u)));
  // A private host with one approved follower: the stranger must not be able to watch.
  await host.send("patch", "/api/users/me", { isPrivate: true });
  await fan.follow(host.user!.id);
  await host.send("post", `/api/follow-requests/${fan.user!.id}/accept`);

  const { createLiveServer } = await import("./live.js");
  liveServer = createLiveServer();
  await new Promise<void>((r) => liveServer.listen(0, r));
  LIVE = `http://localhost:${(liveServer.address() as AddressInfo).port}`;
  const { attachRealtime } = await import("./realtime.js");
  apiServer = http.createServer(app);
  attachRealtime(apiServer);
  await new Promise<void>((r) => apiServer.listen(0, r));
  API = `http://localhost:${(apiServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const { closeRealtime } = await import("./realtime.js");
  await closeRealtime();
  apiServer.close(); liveServer.close();
  await workers.close();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

const socketFor = (c: Client) => new Promise<Socket>((resolve) => {
  const s = ioc(API, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: c.cookies, Origin: ORIGIN } });
  s.once("hello", () => resolve(s));
});
const ingest = (c: Client, id: string, origin = ORIGIN) =>
  new WebSocket(`${LIVE.replace("http", "ws")}/stream/ingest/${id}`, { headers: { Cookie: c.cookies, Origin: origin } });

describe("live video", () => {
  let id = "";
  let ws: WebSocket;

  it("starting creates one record per host; asking again returns the same one", async () => {
    const a = await host.send("post", "/api/live", { title: "Sunset from the roof" }, { "Idempotency-Key": key() });
    expect(a.status).toBe(201);
    expect(a.body.stream.status).toBe("starting");
    id = a.body.stream.id;
    const b = await host.send("post", "/api/live", { title: "again" }, { "Idempotency-Key": key() });
    expect(b.body.stream.id).toBe(id);
  });

  it("only the host can push video, and only from the app's own origin", async () => {
    const evil = ingest(host, id, "https://evil.example");
    await expect(new Promise((_, rej) => { evil.on("error", rej); evil.on("open", () => rej(new Error("opened"))); })).rejects.toThrow(/403/);
    const notHost = ingest(fan, id);
    await expect(new Promise((_, rej) => { notHost.on("error", rej); notHost.on("open", () => rej(new Error("opened"))); })).rejects.toThrow(/409/);
  });

  it("video pushed over the WebSocket becomes a live HLS stream; followers are notified", async () => {
    const clip = "/tmp/glimpse-live-src.webm";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=330",
      "-t", "8", "-c:v", "libvpx", "-deadline", "realtime", "-b:v", "800k", "-c:a", "libopus", clip]);
    const data = fs.readFileSync(clip);
    ws = ingest(host, id);
    const gotLive = new Promise<void>((resolve) => ws.on("message", (m) => { if (JSON.parse(String(m)).type === "live") resolve(); }));
    await new Promise((r) => ws.once("open", r));
    // Like MediaRecorder: a steady drip of chunks, not one big file.
    for (let i = 0; i < data.length; i += 32 * 1024) { ws.send(data.subarray(i, i + 32 * 1024)); await new Promise((r) => setTimeout(r, 40)); }
    await gotLive;
    expect((await host.get(`/api/live/${id}`)).body.stream.status).toBe("live");
    await waitFor(async () => (await fan.get("/api/notifications")).body.notifications.some((n: { type: string; live: { id: string } }) => n.type === "live" && n.live?.id === id), 10000, "live notification");
    expect((await fan.get("/api/live")).body.streams.map((s: { id: string }) => s.id)).toContain(id);
  });

  it("followers can watch; a stranger can't even see that it exists", async () => {
    const pl = await fetch(`${LIVE}/stream/${id}/index.m3u8`, { headers: { Cookie: fan.cookies } });
    expect(pl.status).toBe(200);
    expect(pl.headers.get("cache-control")).toMatch(/no-cache/);
    const text = await pl.text();
    expect(text).toMatch(/#EXTM3U/);
    const seg = text.split("\n").find((l) => l.endsWith(".ts"))!;
    const s = await fetch(`${LIVE}/stream/${id}/${seg}`, { headers: { Cookie: fan.cookies } });
    expect(s.status).toBe(200);
    expect(s.headers.get("content-type")).toBe("video/mp2t");
    fs.writeFileSync("/tmp/glimpse-live-seg.ts", Buffer.from(await s.arrayBuffer()));
    expect(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", "/tmp/glimpse-live-seg.ts"]).toString()).toMatch(/h264[\s\S]*aac/);

    expect((await fetch(`${LIVE}/stream/${id}/index.m3u8`, { headers: { Cookie: stranger.cookies } })).status).toBe(404);
    expect((await fetch(`${LIVE}/stream/${id}/index.m3u8`)).status).toBe(401);
    expect((await stranger.get(`/api/live/${id}`)).status).toBe(404);
    expect((await fetch(`${LIVE}/stream/${id}/..%2f..%2fetc%2fpasswd`, { headers: { Cookie: fan.cookies } })).status).toBe(404);
  });

  it("comments and hearts reach everyone in the room; a stranger can't join", async () => {
    const [sf, sh, ss] = await Promise.all([socketFor(fan), socketFor(host), socketFor(stranger)]);
    const join = (s: Socket) => new Promise<{ ok: boolean; viewers?: number }>((r) => s.emit("live:join", id, r));
    expect((await join(sf)).ok).toBe(true);
    expect((await join(sh)).ok).toBe(true);
    expect((await join(ss)).ok).toBe(false);
    const comment = new Promise<{ text: string; user: { username: string } }>((r) => sh.on("live:comment", r));
    const heart = new Promise((r) => sh.on("live:heart", r));
    const strangerGot: unknown[] = [];
    ss.on("live:comment", (c) => strangerGot.push(c));
    sf.emit("live:comment", { id, text: "  so pretty!  " });
    sf.emit("live:heart", id);
    const c = await comment;
    expect(c.text).toBe("so pretty!");
    expect(c.user.username).toBe("fan");
    await heart;
    ss.emit("live:comment", { id, text: "let me in" }); // not in the room: ignored
    await new Promise((r) => setTimeout(r, 300));
    expect(strangerGot).toEqual([]);
    const ended = new Promise((r) => sf.on("live:ended", r));

    // Ending: the broadcaster says "end"; ffmpeg finishes the playlist; viewers are told.
    ws.send("end");
    await ended;
    await waitFor(async () => (await host.get(`/api/live/${id}`)).body.stream.status === "ended", 10000, "ended");
    const last = await (await fetch(`${LIVE}/stream/${id}/index.m3u8`, { headers: { Cookie: fan.cookies } })).text();
    expect(last).toMatch(/#EXT-X-ENDLIST/);
    expect((await fan.get("/api/live")).body.streams).toEqual([]);
    sf.disconnect(); sh.disconnect(); ss.disconnect();
  });

  it("a crashed live service doesn't leave streams 'live' forever", async () => {
    const s = await fan.send("post", "/api/live", {}, { "Idempotency-Key": key() });
    const sid = s.body.stream.id;
    // Simulate "the live service crashed mid-stream": live in the database, but no heartbeat in Redis.
    const pg = (await import("pg")).default;
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await owner.connect();
    await owner.query("update live_streams set status = 'live', started_at = now() where id = $1", [sid]);
    await owner.end();
    const { queue } = await import("./infra/queues.js");
    await queue("maintenance").add("live.reap", {});
    await waitFor(async () => (await fan.get(`/api/live/${sid}`)).body.stream.status === "ended", 10000, "reaped");
  });
});
