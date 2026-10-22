# Glimpse v2 design decisions

One record per decision: the problem, the options, what was chosen, why, and what it costs. These were chosen during the build. **Review each one; if you'd decide differently, say so and it gets changed.** Being able to argue for (or against) each line here is the point of this file.

Status key: ✅ built and tested · 🟡 built, verified manually only

---

## D1. Redis: two instances with different jobs ✅

**Problem:** Redis holds cache, feeds, queues, pub/sub and rate limits. Losing cache is harmless, but losing queued jobs isn't. One `maxmemory-policy` can't fit both.

| Option | For | Against |
|---|---|---|
| One Redis, AOF, `noeviction` | Simple | A full cache blocks writes |
| One Redis, `allkeys-lru` | Ideal cache | Evicts queue jobs; BullMQ requires `noeviction` |
| **Two: `redis-cache` + `redis-queue`** | Each tuned for its data | One more container |

**Decision:** two instances.
- `redis-cache`: 128 MB, `allkeys-lru`, no persistence. Holds cache, feeds, counters, presence, rate limits and Socket.IO streams.
- `redis-queue`: AOF `everysec`, `noeviction`. Holds BullMQ only.

**Why:** everything in `redis-cache` can be rebuilt from Postgres or safely forgotten. Feeds rebuild on a miss, and rate limits just reset. Jobs can't be rebuilt, so they get durability.
**Cost:** ~10 MB more RAM; at most about 1 s of jobs lost if `redis-queue` crashes (AOF `everysec`). The outbox (D5) re-sends anything not acknowledged.

## D2. Queue: BullMQ 5 ✅

| Option | For | Against |
|---|---|---|
| **BullMQ (Redis)** | Retries, backoff, delays, priorities, rate limits, repeatable jobs, a dashboard | Needs a durable Redis |
| pg-boss (Postgres `SKIP LOCKED`) | No new infra | Puts job load on the main database |
| RabbitMQ | Real broker, dead-letter exchanges | Another service to run |
| Kafka / Redpanda | Replayable log, huge scale | Far too heavy for one MacBook at this scale |

**Decision:** BullMQ 5.x (pinned to the stable 5 line; 6.0 came out July 2026, so upgrading is a follow-up after reading its migration notes).
**Why:** the jobs here are task-shaped (transcode this, fan out that), not an event log that many consumers replay, which is where Kafka earns its cost.
**Cost:** no event replay. If a new consumer needs old events, it rebuilds from Postgres.

Queues: `media` (concurrency 1 for video, 3 for images), `fanout`, `notify`, `maintenance` (repeatable cleanup jobs). Every job: 5 attempts, exponential backoff from 2 s. Jobs that fail permanently stay in BullMQ's failed set (our dead-letter queue), visible and retryable in the dashboard at `/admin/queues`.

## D3. Feed: hybrid fan-out ✅

**Decision:**
- **Push** a post id into each follower's `feed:{userId}` sorted set when the author has fewer than **`FANOUT_THRESHOLD` followers (default 10,000)**.
- **Pull** posts from authors above the threshold at read time and merge them in.
- Timelines are capped at **800 ids** and expire after **14 days without a read**. Scrolling past the end falls back to a Postgres query.

**Why:**
- **Push** keeps reads to one Redis call for almost everyone.
- **Pull** for the few huge accounts avoids one post causing 1,000,000 writes.
- **Expiry** means inactive users cost nothing; their timeline is rebuilt from Postgres when they come back.

**Cost:** feeds are eventually consistent (a post appears in followers' feeds after the fan-out job runs, normally under a second). Unfollow and delete are filtered at read time, then cleaned in the background.
**Tested:** a test sets the threshold to 2 and checks that a "celebrity" post is not pushed but still shows up in the feed.

## D4. Caching ✅

1. **Pattern:** cache-aside. Read from cache, otherwise from the database, then store. On write: update the database, then delete the key.
2. **Invalidation:** delete on write, plus a TTL (10 min for posts, 5 min for profiles) as a safety net.
3. **Stampede protection:** single-flight. The first request to miss takes a short Redis lock (`SET NX PX 3000`) and loads from the database. Concurrent requests wait briefly and read the fresh value. Inside each process, identical in-flight loads are also shared.
4. **Shared vs per-viewer:** shared entries hold only what every signed-in user may see: post content, media, author's public profile, counts. Per-viewer facts (`likedByMe`, `savedByMe`, `repostedByMe`, `isFollowing`) are fetched for the whole page in one batched query per request and never cached in shared keys.
5. **Negative caching:** "not found" is cached for 30 s, so repeated requests for deleted posts don't hit the database.

**Why this matters here:** Glimpse uses row-level security, and a shared cache sits outside it. Today every signed-in user may see every post, so post content is safe to share. **If private accounts are added later, post entries must stop being shared, or be keyed by audience.** This is written into the code next to the cache.
**Cost:** a deleted post can live in another instance's in-process single-flight for milliseconds. Counters can be briefly stale (see D9).

## D5. Database → queue: transactional outbox ✅

**Decision:** outbox table plus a relay that polls every 250 ms. A Postgres `LISTEN/NOTIFY` (`outbox_new`) wakes the relay immediately when an event is written. The relay claims rows with `FOR UPDATE SKIP LOCKED`, so several relays can run safely.

**Why:** the event row is written in the same transaction as the post, like or comment. Either both exist or neither does. `NOTIFY` makes it near-instant, and polling covers missed notifications.
**Idempotent consumers:**
- BullMQ `jobId` = outbox event id, so a re-sent event is ignored.
- Writes are naturally repeatable: `ZADD` to a sorted set, and `INSERT … ON CONFLICT DO NOTHING` for notifications.

## D6. Google sign-in ✅ (tested against a mock Google; needs your real client ID to go live)

- **Flow:** authorization code with PKCE, `state` and `nonce` in a short-lived httpOnly cookie. The ID token is verified against Google's published keys for issuer, audience, expiry and nonce.
- **Linking:** auto-link to an existing account **only if Google says `email_verified: true`**. Otherwise a new account is created. Without that check, someone could register a Google account with your unverified email and take over your Glimpse account.
- **Chat keys:** Google users set a separate **chat passcode** the first time they open messages. It wraps their private key exactly like the password does for normal users.
- **Cost:** one more secret for Google users to remember. Device-to-device linking with a QR code (like WhatsApp) is stronger, but much more work. It's listed as future work.

## D7. Group chats: group key, rotated on membership change ✅

**Decision:**
- Each group has a symmetric key per **epoch**. The key is wrapped (`crypto_box`) for every current member by whoever changed the membership.
- Adding or removing someone starts a new epoch with a new key.
- Messages carry their epoch number. Maximum group size: 32.

**Why:** one ciphertext per message regardless of group size, and easy to reason about:
- **Removed members** never receive the new epoch's key, so they can't read later messages.
- **New members** only get the current epoch's key, so they don't see history.

**Cost:**
- **No forward secrecy within an epoch.** Signal's sender keys or MLS (RFC 9420) solve this at much higher complexity.
- **Membership changes must be made by a member's browser**, because the server can't generate or see keys.

## D8. Media pipeline ✅

- **Uploads:** the API validates magic bytes, stores the original privately, and returns `202` with `status: processing`. A worker does the rest. The client gets `media:status` over the socket.
- **Images:** WebP at 480 px and 1080 px wide (`srcset`). No metadata kept.
- **Videos (posts and shorts):** HLS with two renditions, 360p and 720p, plus a poster image. A 2018 MacBook can't transcode 1080p fast enough to be worth it.
- **Concurrency:** 1 video job and 3 image jobs per worker. Scale by adding workers, not concurrency.
- **Originals:** deleted after successful processing.

## D9. Counters: write-through to a Redis hash ✅

**Decision:** Postgres stays the source of truth (a like is a row). Counts live in `post:{id}:stats` (likes, comments, reposts). On every like or unlike, the count is changed with `HINCRBY`, but only if the hash exists. A missing hash is rebuilt from `count(*)`. The hash expires after 1 hour.

**Why:** reads become one Redis call, and there's no hot-row lock on viral posts. **Drift repair:** if an increment is lost, the 1-hour expiry forces a recount from Postgres.

## D10. Shaders: one canvas for background and cards ✅

**Decision:** one fixed, fullscreen WebGL canvas behind the app. Each frame it receives the screen rectangles of up to 16 visible cards as uniforms. The fragment shader draws the background field everywhere and a quieter "paper" material inside the card rectangles. The cards themselves are transparent.
- **Why:** one WebGL context, no matter how long the feed is, instead of hitting the browser's limit of about 16.
- **Performance:** device pixel ratio capped at 1.5, paused when the tab is hidden.
- **Fallbacks:** with `prefers-reduced-motion`, or if WebGL fails, a static WebP takes its place.

## D11. Real-time across instances ✅

- **Transport:** `transports: ["websocket"]` only. Long-polling would need sticky sessions across the two API instances, and WebSocket support is universal now.
- **Adapter:** Redis **Streams** adapter (not plain pub/sub). An instance that briefly loses Redis catches up on missed events instead of silently dropping them.
- **Presence:** sorted set `presence` (score = last heartbeat). Each socket heartbeats every 20 s, and a user counts as online if their heartbeat is under 50 s old. A crashed instance's users go offline automatically when their heartbeats stop.
- **Rate limits:** stored in `redis-cache` (`rate-limit-redis`), so limits hold across instances.

## D12. Observability (added) ✅

- **Metrics:** `prom-client` exposes Prometheus metrics at `/api/internal/metrics` (internal network only): request latency, cache hits and misses, queue depth, fan-out size.
- **Ops page:** an **Ops** page for admins (`ADMIN_USERNAMES`) shows them live during a demo, plus which API instance served the request.
- **Queues:** Bull Board at `/admin/queues` (admins only).

## D13. Background workers get their own database role (added) ✅

**Decision:** workers connect as `glimpse_worker`, not as the app role. It has `BYPASSRLS`, but only the grants its jobs need (migration `0005_v2_security`): read the social tables (users, follows, posts, media, mentions, stories, conversation membership, outbox); insert `notifications`; update only the processing columns of `media` and the delivery columns of `outbox`; delete expired stories, abandoned media and old outbox rows. It has no grant at all on `messages`, `group_keys`, `key_backups`, `user_credentials` or `sessions`, so even a compromised worker can't read ciphertext, key backups or log-in data.

**Why:** a worker does system work across many users (fan-out writes to every follower's feed, a notification goes to someone other than the actor), so it can't act "as one user" under RLS. Giving it the owner role would mean a bug in a media job could drop tables. A separate role keeps RLS absolute for every request path, and makes the exception narrow, named and reviewable in one migration (`0005_v2_security`).

**Trade-off:** one more password in `.env` (`WORKER_DB_PASSWORD`), and grants must be updated when a job needs a new table. A forgotten grant fails loudly ("permission denied"), which is the right way to fail.
