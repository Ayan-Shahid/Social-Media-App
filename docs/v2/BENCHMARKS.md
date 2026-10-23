# Benchmarks

Measured on the build machine: **2 vCPUs, 8 GB RAM**, everything on one box (Postgres 16, two Redis instances, API, Caddy, and the load generator). Tool: `autocannon`, 20 connections, 10 seconds per endpoint, logged in as a user who follows one active account. Small dataset (a handful of users and posts).

Treat the absolute numbers as "laptop numbers". What matters is the comparison, and the reasons behind it.

## 1. Read-through cache on vs off (one API instance)

`CACHE_BYPASS=true` makes `cached()` / `cachedMany()` call the database loader directly, so both runs execute the same code apart from Redis.

| Endpoint | Cache on (req/s) | Cache off (req/s) | Gain | p50 on / off (ms) |
|---|---:|---:|---:|---:|
| `GET /api/posts/feed` | 347 | 246 | 1.4× | 51 / 77 |
| `GET /api/posts/:id` | 537 | 324 | 1.7× | 35 / 59 |
| `GET /api/posts/explore` | 565 | 378 | 1.5× | 33 / 51 |
| `GET /api/users/:username` | 756 | 648 | 1.2× | 25 / 29 |

No errors and no non-2xx responses in any run.

**Why the gain is "only" 1.2–1.7×:** every request still does one Postgres round trip of its own. It looks up the session and opens a transaction that sets `app.user_id` for row-level security. With a tiny dataset, Postgres also serves everything from memory, so a cache miss is cheap. The cache pays off more as:
- the data outgrows Postgres's buffers (misses start hitting disk);
- many API instances share one database (the cache absorbs reads that would otherwise queue on Postgres connections);
- a post goes viral. The system test `500 concurrent requests for one uncached post -> 1 database load` (`apps/api/src/system.test.ts`) shows single-flight turning a stampede into one query. That isn't visible in a throughput number at all.

**Next step if this were production:** cache the session lookup itself (a short-TTL `session:{hash}` key, deleted on logout). That's the remaining per-request database hit.

## 2. Failover: stop one API instance under load

Through Caddy (round-robin over `api-1` and `api-2`, active health checks every 5 s, `lb_retries 2`), 16 seconds of load on `GET /api/posts/feed`:

- t = 4 s: `api-1` gets `SIGTERM` (what `docker compose stop` / a redeploy sends). It stops accepting connections, finishes in-flight requests, and exits.
- t = 10 s: `api-1` is started again and rejoins once its health check passes.

| Requests | Avg req/s | Errors | Non-2xx | Timeouts | p99 |
|---:|---:|---:|---:|---:|---:|
| 4,848 | 303 | **0** | **0** | 0 | 182 ms |

This works because nothing lives in one instance's memory. Sessions are in Postgres; cache, rate limits and presence are in Redis; live events go through Redis Streams. Websocket-only Socket.IO means no sticky sessions, so a client whose instance disappears just reconnects to the other one.

## 3. Likes: many people, one post (`scripts/bench-likes.mjs`)

300 accounts, one post (uploaded through the real flow), everything through Caddy → `api-1`/`api-2` → Postgres + Redis, on the same 2 vCPUs as the load generator. Run with `RATE_LIMIT_SCALE=1000`: with real limits each person is held to about one like per second, which is the point in production but would measure the limiter.

| Phase | Connections | Throughput | p50 | p95 | p99 | Errors | Count correct |
|---|---:|---:|---:|---:|---:|---:|---|
| 300 people like at once | 20 | 123–167 likes/s | 110–144 ms | 208–344 ms | 236–383 ms | 0 | ✅ 300 |
| like/unlike for 20 s | 20 | 231–263 req/s | 64–74 ms | 176–204 ms | 219–249 ms | 0 | ✅ |
| like/unlike for 20 s | 50 | 257 req/s | 179 ms | 418 ms | 473 ms | 0 | ✅ |

The ceiling is CPU: going from 20 to 50 connections adds latency, not throughput. Each like is a transaction (session lookup, `app.user_id`, RLS check, insert, outbox row) plus a Redis increment and a count read.

- **No lost or double-counted likes.** After each phase, the count the app shows equals the number of people whose last action was "like".
- **Notifications stay small.** The ~5,000 like events in a run became **one** notification row for the post. Its count read 297 people against the true 299 (HyperLogLog's ~1% error; the author's own likes aren't notified).
- **The limiter:** at real limits (`RATE_LIMIT_SCALE=1`), 45 instant clicks on one heart in a browser gave 30 × `200` then 15 × `429`, and the "too fast" toast (`scale.test.ts` checks the same).

## 4. Why there's no "1 vs 2 instances" throughput table

On 2 vCPUs, a second Node process competes for the same two cores as Postgres, Redis and the load generator, so the number would measure CPU contention, not the architecture. Horizontal scaling is shown instead by **correctness across instances** (system tests run two real API processes: a message sent through one is delivered by the other, presence and login rate limits are shared) and by the failover result above. To measure scale-out properly, run the instances on separate machines with the database on its own host.

## Reproduce

```bash
# stack running (docker compose up), logged-in cookie in $COOKIE
npx autocannon -c 20 -d 10 -H "Cookie: $COOKIE" http://localhost:8090/api/posts/feed
# cache off: add CACHE_BYPASS: "true" to api-1 and api-2 in docker-compose.yml, then docker compose up -d

# likes (dev database only: it creates accounts). Raise the limits for the run: RATE_LIMIT_SCALE=1000 on api-1/api-2.
node scripts/bench-likes.mjs http://localhost:8090 300 20 20
```
