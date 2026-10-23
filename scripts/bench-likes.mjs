#!/usr/bin/env node
// Load test for liking (docs/v2/BENCHMARKS.md, section 4). Many users like ONE post at the same time,
// then keep liking/unliking it, through the real stack (Caddy -> both API instances -> Postgres/Redis).
//
//   node scripts/bench-likes.mjs [baseUrl] [users] [seconds] [connections]
//   node scripts/bench-likes.mjs http://localhost:8090 300 20 50
//
// Run the API with RATE_LIMIT_SCALE=1000 for this: real limits stop one user at ~1 like/second, which is
// the point in production but would make this measure the rate limiter instead of the like path.
// Creates real accounts (bench_<run>_<n>) and one post: use a dev database, not production.
import { setTimeout as sleep } from "node:timers/promises";
import { randomBytes } from "node:crypto";

const [BASE = "http://localhost:8090", USERS = "300", SECONDS = "20", CONNS = "50"] = process.argv.slice(2);
const N = Number(USERS), DURATION = Number(SECONDS) * 1000, C = Number(CONNS);
const RUN = randomBytes(3).toString("hex");
const b64 = (n) => randomBytes(n).toString("base64");

/** A logged-in browser-like session: cookies + CSRF header + Origin, like the web app. */
class Session {
  cookies = new Map();
  get csrf() { return this.cookies.get("glimpse_csrf") ?? this.cookies.get("__Host-glimpse_csrf") ?? ""; }
  async req(method, path, body, extra = {}) {
    const headers = { Origin: BASE, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...extra };
    if (method !== "GET") headers["X-CSRF-Token"] = this.csrf;
    if (body !== undefined && !(body instanceof Uint8Array)) headers["Content-Type"] = "application/json";
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); }
    return r;
  }
  async register(username) {
    await this.req("GET", "/api/auth/csrf");
    const r = await this.req("POST", "/api/auth/register", {
      username, email: `${username}@bench.invalid`, password: "correct horse battery",
      // Throwaway key material: the benchmark never opens messages.
      keys: { publicKey: b64(32), backup: { ciphertext: b64(72), nonce: b64(24), salt: b64(16), opsLimit: 2, memLimit: 16 * 1024 * 1024 } },
    });
    if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${await r.text()}`);
    return this;
  }
}

async function pool(items, conc, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

console.log(`Creating ${N} users (run ${RUN})...`);
const t0 = Date.now();
const users = new Array(N);
await pool([...Array(N).keys()], 8, async (k) => { users[k] = await new Session().register(`bench_${RUN}_${k}`); });
console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// The author posts one photo through the real upload flow (slot -> PUT to storage -> complete).
const author = users[0];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"); // 1x1 PNG
const slot = await (await author.req("POST", "/api/media/uploads", { purpose: "post", mime: "image/png", size: png.length }, { "Idempotency-Key": `b${RUN}a` })).json();
const put = await fetch(slot.upload.url, { method: "PUT", body: png, headers: slot.upload.headers });
if (!put.ok) throw new Error(`upload PUT ${put.status}`);
await author.req("POST", `/api/media/${slot.media.id}/complete`);
for (let i = 0; ; i++) {
  const m = await (await author.req("GET", `/api/media/${slot.media.id}`)).json();
  if (m.media.status === "ready") break;
  if (i > 100) throw new Error("media never became ready");
  await sleep(200);
}
const post = (await (await author.req("POST", "/api/posts", { mediaIds: [slot.media.id], caption: "like me" }, { "Idempotency-Key": `b${RUN}p` })).json()).post;

// Phase 1: everyone likes at once (well, C at a time). Every like must be counted exactly once.
console.log(`Phase 1: ${N} users like post ${post.id}, ${C} in flight...`);
const lat1 = []; const status1 = {};
const t1 = Date.now();
await pool(users, C, async (u) => {
  const s = performance.now();
  const r = await u.req("PUT", `/api/posts/${post.id}/like`);
  lat1.push(performance.now() - s);
  status1[r.status] = (status1[r.status] ?? 0) + 1;
});
const secs1 = (Date.now() - t1) / 1000;
const count = (await (await author.req("GET", `/api/posts/${post.id}`)).json()).post.likeCount;
console.log(`  ${N} likes in ${secs1.toFixed(2)} s = ${(N / secs1).toFixed(0)} likes/s; p50 ${pct(lat1, 50).toFixed(0)} ms, p95 ${pct(lat1, 95).toFixed(0)} ms, p99 ${pct(lat1, 99).toFixed(0)} ms; statuses ${JSON.stringify(status1)}`);
console.log(`  like count shown: ${count} (expected ${N}) -> ${count === N ? "CORRECT" : "WRONG"}`);

// Phase 2: sustained. Each user toggles like/unlike on the same post for DURATION.
console.log(`Phase 2: like/unlike the same post for ${DURATION / 1000} s, ${C} in flight...`);
const lat2 = []; const status2 = {}; const liked = new Array(N).fill(true);
const end = Date.now() + DURATION;
let next = 0;
await Promise.all(Array.from({ length: C }, async () => {
  while (Date.now() < end) {
    const k = next++ % N;
    const s = performance.now();
    const r = await users[k].req(liked[k] ? "DELETE" : "PUT", `/api/posts/${post.id}/like`);
    lat2.push(performance.now() - s);
    status2[r.status] = (status2[r.status] ?? 0) + 1;
    if (r.status === 200) liked[k] = !liked[k];
  }
}));
const expected = liked.filter(Boolean).length;
await sleep(500);
const count2 = (await (await author.req("GET", `/api/posts/${post.id}`)).json()).post.likeCount;
console.log(`  ${lat2.length} requests = ${(lat2.length / (DURATION / 1000)).toFixed(0)} req/s; p50 ${pct(lat2, 50).toFixed(0)} ms, p95 ${pct(lat2, 95).toFixed(0)} ms, p99 ${pct(lat2, 99).toFixed(0)} ms; statuses ${JSON.stringify(status2)}`);
console.log(`  like count shown: ${count2} (expected ${expected}) -> ${count2 === expected ? "CORRECT" : "WRONG"}`);
console.log(JSON.stringify({ run: RUN, users: N, connections: C, phase1: { seconds: secs1, perSecond: N / secs1, p50: pct(lat1, 50), p95: pct(lat1, 95), p99: pct(lat1, 99), status: status1, correct: count === N },
  phase2: { requests: lat2.length, perSecond: lat2.length / (DURATION / 1000), p50: pct(lat2, 50), p95: pct(lat2, 95), p99: pct(lat2, 99), status: status2, correct: count2 === expected } }));
