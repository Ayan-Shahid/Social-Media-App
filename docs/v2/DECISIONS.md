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

- **Uploads:** since D14, the browser uploads straight to private object storage with a signed URL. On "complete", the API checks the size and magic bytes and returns `202` with `status: processing`. A worker does the rest. The client gets `media:status` over the socket.
- **Images:** WebP at 480 px and 1080 px wide (`srcset`). No metadata kept.
- **Videos (posts and shorts):** HLS with two renditions, 360p and 720p, plus a poster image. A 2018 MacBook can't transcode 1080p fast enough to be worth it.
- **Concurrency:** 1 video job and 3 image jobs per worker. Scale by adding workers, not concurrency.
- **Originals:** deleted from the private bucket after successful processing (they may carry GPS/EXIF data).

## D9. Counters: write-through to a Redis hash ✅

**Decision:** Postgres stays the source of truth (a like is a row). Counts live in `post:{id}:stats` (likes, comments, reposts). On every like or unlike, the count is changed with `HINCRBY`, but only if the hash exists. A missing hash is rebuilt from `count(*)`. The hash expires after 1 hour.

**Why:** reads become one Redis call, and there's no hot-row lock on viral posts. **Drift repair:** if an increment is lost, the 1-hour expiry forces a recount from Postgres.

**Updated (D21):** the increment now runs only *after* the like's transaction commits (before, a failed commit could leave the number one too high for up to an hour), and a missing hash is recounted once, not once per request.

## D10. Background: a live shader for the wall only, grid-matrix cards, and a 3D camera ✅

**History.** The first version ran one WebGL canvas that drew the wall *and* the cards' paper (from their screen rectangles). While scrolling, card content moved a frame before the shader caught up, so contents and their backgrounds visibly separated. The fix keeps the canvas but takes the cards out of it.

**Decision now:**
- **Wall:** one fixed WebGL canvas (`BackgroundShader.tsx`). It draws three parallax layers of line-drawn hearts, chat bubbles, @, #, cameras and play buttons, drifting upward over two soft glows, with film grain. It's a full-screen backdrop that doesn't depend on page content, so there's nothing for it to lag behind. A like or a new message sends a ripple from that point, and the icons it passes light up (up to 8 at once, as a uniform array). Light/dark cross-fade is time-based (~0.4 s). Device pixel ratio is capped at 1.5, and it pauses when the tab is hidden.
- **Fallback:** the same shader pre-rendered to WebP (light/dark × wide/tall) sits underneath. It shows before the first frame, with no WebGL, or if the context is lost. `scripts/backdrop-shader.html` and `scripts/render-backdrop.mjs` regenerate it.
- **Cards:** CSS "engineering paper": a fine grid matrix (minor line every 12px, major every 48px), drawn by the card itself, so it scrolls with its content by definition.
- **Buttons:** grainy mesh-gradient WebP textures (`scripts/generate-textures.mjs`), sized to 170%×320% of each button so even small ones span several colours. Hover slides the window across the mesh. Flat 1px borders, no bevels.
- **Floating reactions:** a few hearts or bubbles rise from where you liked (DOM + CSS animation), alongside the shader ripple.
- **3D camera** (auth and landing pages): a film rangefinder modelled in code with three.js, loaded only on those pages and paused off-screen.

**Dark mode** follows the system by default; Settings or the sidebar can pin Light or Dark for this device. It's applied by an inline script before first paint (with the CSP nonce), so there's no flash, and synced to other open tabs through the `storage` event.

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

## D14. Object storage: S3 API, SeaweedFS, signed direct uploads (added) ✅

**Decision:** photos and videos live in S3-compatible object storage, not on the API's disk. In Docker that's **SeaweedFS**; the code only speaks the S3 API, so Cloudflare R2 or AWS S3 is a config change.

- **Why not MinIO:** its free edition stopped shipping Docker images and binaries in October 2025, and the repository was archived in 2026. A Compose file pinned to it would run an unpatched image forever. SeaweedFS is Apache-2.0, actively released, and has an official image.
- **Two buckets, two rules.** `uploads` is private: originals, which may carry GPS/EXIF data, and are deleted after processing. `media` is public-read: only the worker writes there, and only re-encoded files under random keys.
- **Direct uploads.** The browser asks the API for a slot (declaring type and size). It gets a URL signed for exactly that Content-Type and Content-Length, valid for 10 minutes, and PUTs the file straight to storage. Then it calls `complete`. The API never carries file bytes, so a 60 MB video doesn't hold an API worker for the whole upload, and API memory stays flat.
- **Trust nothing the browser declared.** On `complete`, the API checks the stored size and the magic bytes of the first 4 KB. The worker checks the type again on the full file before decoding. A mismatch fails the upload and deletes the object.
- **Same-origin through Caddy.** URLs are signed for the public address. Caddy forwards `PUT /uploads/*` to storage with the Host header untouched (the signature covers it), and `GET /media/*` with `nosniff` and a sandbox CSP. Any other method on those paths gets a 405, so originals can't be read from outside even if storage were misconfigured. No CORS setup is needed.
- **RLS for the state machine.** The app role may update a media row only while it's the owner's and still `uploading`, and only to `processing` or `failed`. Everything after that belongs to the worker role.
- **Cleanup, in two phases, so the database never forgets a file it hasn't deleted** (updated). Uploads never completed (after an hour) and media nothing uses (after a day) are first marked `deleting`. At least 10 minutes later the files are deleted, *then* the row. If storage refuses, the row stays `deleting` and the next hourly run retries. Before deleting, each row is checked once more; if something started using it, it's put back. Only `ready` media can go into a post, checked by the route and again by the database's insert policy, so a row being deleted can't be attached.
- **Weekly safety net** (`storage.reconcile`): lists both buckets and deletes files older than a day whose media row doesn't exist. It catches anything the rules above miss, including future bugs, and reports what it found on the Ops page.

What happens when one side fails:

| Fails | Left behind | Resolved by |
|---|---|---|
| Database, when asking for a slot | nothing (no row, no signed URL) | the user retries |
| Upload to storage | row `uploading`, no file | browser retry within 10 min, else hourly cleanup |
| `complete` never sent (tab closed) | row `uploading` + file | hourly cleanup (both) |
| File fails the size/type check | — | file deleted at once, row `failed` |
| Database, while marking `processing` | row `uploading` + file | `complete` is safe to repeat; else cleanup |
| Worker crash / storage blip while processing | partial variants | 5 retries with backoff; variants have fixed keys, so retries overwrite |
| All retries fail | — | row `failed`, partial files and original deleted, job kept in the dead-letter set |
| Post creation after media is `ready` | unused media | cleanup after a day |
| Deleting files during cleanup | row `deleting` | next run retries; the weekly check is the backstop |

**Trade-off:** public media URLs are unguessable but not signed per viewer. A follower of a private account who copies an image URL can share it, as with most CDNs. Per-viewer signed GET URLs would close that, at the cost of HTTP caching and cache entries that expire.

## D15. Privacy: private accounts, follow requests, block, mute (added) ✅

**Decision:** visibility is one Postgres function, `app.can_see(author)`. It means: it's me; or there's no block either way, and the account is public or I follow it. The `posts`, `stories`, `comments` and `live_streams` read policies all use it. Likes, comments, reposts and saves have insert checks of the form `exists (select 1 from posts where id = post_id)`. RLS applies inside that subquery too, so "you can only like what you can see" comes free from the posts policy.

- **Follow requests:** the follows insert policy only allows direct follows of public, unblocked accounts. Private ones go through `follow_requests`. Accepting inserts a follow row whose follower is *someone else*, which no policy should allow, so it's a narrow `SECURITY DEFINER` function: `app.accept_follow_request(requester)` only works for a pending request to the caller. Going public accepts every pending request in the same transaction.
- **Blocks:** `app.block_user()` records the block and cuts follows and requests in both directions, atomically. Only the blocker can read their blocks. The other side sees "user not found" and content disappearing; `app.blocked_with(other)` answers only about the caller, so nobody can probe who blocked whom. A block also stops new messages in a 1:1 chat (`messages` insert policy), and hides past and future notifications across it.
- **Mutes** are a preference, not a permission. They filter the feed (kept in the timeline, hidden at read time, so unmuting brings items back), the stories tray, the live list and live notifications. A muted account's posts are still reachable directly.
- **Discovery** (explore, shorts, hashtags) shows public accounts only, like Instagram. Profile counts stay public.

**The hard part: caching vs. per-viewer visibility.** Post content is cached once in Redis and shared by every viewer (D4), and a cache hit skips RLS. Tests caught three leaks, all fixed:
1. **Content:** hydration always runs one per-viewer query, which was already there for "liked by me". That query now reads `posts` under the viewer's RLS, and a post with no row is dropped, even if its content came from the cache. The cache stores content; it never decides visibility.
2. **Negative caching:** a stranger's miss on a private post would have cached "not found" for everyone, hiding it from followers for 30 s. Post caches don't cache misses (`negative: false`), because under RLS "no row" can mean "not for you".
3. **Counters:** profile counts were computed under the first viewer's RLS and then shared, so a stranger would cache "0 posts". They're now counted over all rows by a definer function, since they're public facts.

`privacy.test.ts` covers each of these, including both cache orders.

## D16. Live video: WebSocket ingest -> ffmpeg -> HLS, in its own service (added) ✅

**Decision:** the browser records the camera with `MediaRecorder` (0.5 s chunks: WebM in Chrome and Firefox, MP4 in Safari) and sends them over a WebSocket to a separate `live` service. There, ffmpeg re-encodes to H.264/AAC (short side ≤ 720p, keyframe every 2 s) and writes a rolling 6-segment HLS playlist. Viewers play it with hls.js (natively in Safari). Comments, hearts and viewer counts go over the existing realtime bus (D11) into a Socket.IO room per stream, so they work across both API instances.

- **Why not WebRTC (WHIP/WHEP with an SFU such as MediaMTX or LiveKit):** it would cut latency from ~4–6 s to under 1 s. But it adds a media server, UDP ports and TURN for viewers behind strict NATs, none of which pass through a Cloudflare Tunnel. HLS reuses parts the app already has (ffmpeg, hls.js, HTTP), works through the tunnel, and could be cached by a CDN. It's the upgrade path if latency ever matters more.
- **Stateful by nature:** a stream lives in the process ingesting it, so `live` is its own service, not load-balanced. To scale it, assign streams to live servers (e.g. by hashing the stream id) and upload segments to object storage or a CDN instead of serving them from local disk.
- **Access:** the ingest WebSocket checks Origin, the session, that the caller is the host, and that only one ingest runs per stream. Every playlist and segment request is checked against RLS (`live_streams_select` uses `app.can_see`), cached for 20 s per viewer and stream. A private account's live is visible only to approved followers. A stranger gets 404, not 403, so they can't tell it exists.
- **Lifecycle:** the database row goes `starting -> live` (when the first segment exists; that's when the outbox emits `live.started`, and followers are notified) and then `ended`. A user can have only one unfinished stream (partial unique index). Ending writes `#EXT-X-ENDLIST`, and viewers are told over the bus. Segments are deleted 2 minutes later; there is no replay.
- **Crash recovery:** while ingesting, the service refreshes `live:<id>:alive` (15 s TTL). A maintenance job ends any `live` stream whose key has expired, for example after the container restarts.
- **Backpressure:** if ffmpeg falls behind by more than 16 MB (CPU-starved), the stream is stopped with a message instead of buffering until the process runs out of memory. Streams are capped at `MAX_LIVE_MINUTES`.

**Tested:** `live.test.ts` pushes a real WebM through the real service and checks the HLS output with ffprobe (H.264 + AAC), access for follower, stranger and anonymous viewers, path traversal, the room for comments and hearts, ending, and crash reaping. The browser test goes live from Chromium's fake camera through Caddy.

## D17. Message envelopes: what's inside the encryption (added) ✅

Every encrypted message's plaintext is a small JSON envelope: text, a shared post (`postId` and an optional note), a story reply (story id, thumbnail URL, text) or a story reaction (emoji). The server can't tell them apart from ordinary text, so it never learns which post was shared or which story was answered. When the recipient opens a shared post, the API checks *their* access, so a private post shared with a non-follower shows "unavailable". Messages from before envelopes existed decode as plain text. Sharing to several chats sends one ciphertext per conversation, each with its own idempotency key, so retrying after a partial failure never duplicates.

## D18. Sessions across tabs and devices (added) ✅

- **Each device or browser has its own session:** a random token in an httpOnly cookie, with the server storing only its hash. Logging in on the phone doesn't touch the laptop's session.
- **Tabs of one browser share that cookie, so they're one session.** Each tab still has its own JavaScript state and its own websocket. A `BroadcastChannel` keeps them in step: log out in one tab and every tab signs out; log in, or change your profile, and the others refresh; unlock messages in one, and the others load the key from IndexedDB (shared per browser) without asking again.
- **Session gone** (expired, or revoked elsewhere): any API 401 signs the tab out and sends it to the login page, instead of leaving a half-working screen.
- **Live sync:** every tab and device opens its own websocket. Events go to a per-user room on whichever API instance each socket is connected to (D11), so a message, notification or upload result appears on all of them at once. Presence counts connections, so closing one tab doesn't mark you offline while another is open. Anything not pushed (like counts, profiles) is re-fetched when a tab or app regains focus, and `staleTime` (30 s) keeps that cheap.
- **Encryption keys per device:** the private message key never leaves a browser unencrypted. A new device downloads the password-protected backup and unlocks it locally (Argon2id), so the server can't.

## D19. CI/CD: test and build on GitHub, deploy by pulling on the MacBook (added) ✅

**Decision:** one workflow (`.github/workflows/ci-deploy.yml`) has five jobs.
1. **API tests on GitHub-hosted Ubuntu:** real Postgres 18, two Redis instances, an S3 API (moto) and ffmpeg. The same 95 tests as locally.
2. **Web:** typecheck and production build.
3. **Config:** `docker compose config` with and without the tunnel profile, `caddy validate`, and shellcheck.
4. **Images:** built for `linux/amd64` and pushed to GHCR tagged with the **commit SHA** (only for `main`). The build uses layer caching.
5. **Deploy:** on a self-hosted runner on the MacBook, label `glimpse`, `production` environment. It runs `deploy/deploy.sh`.

- **Build in CI, pull on the Mac.** A 2018 MacBook building two Node images and a Next.js app on every deploy would take long and starve Veritas. Pulling prebuilt images takes a minute or two. The Mac runs *exactly* the bytes that passed the tests: the same SHA tag, not a rebuild that could differ.
- **Pull, not push.** The Mac opens no inbound ports: the runner polls GitHub, and the site is reached through Cloudflare Tunnel. Nothing on the Mac is exposed to the internet except through Caddy via the tunnel.
- **Self-hosted runner on a public repo** is the classic risk: anyone's fork PR could run code on your machine. Mitigations:
  - Only the deploy job targets the Mac. It runs only for `push` to `main` in this repository (`if:` guard), and only in the `production` environment, which is restricted to `main` and can require approval.
  - PR jobs use GitHub-hosted runners only.
  - The deploy job's token can only read packages and contents.
  - Fork PR workflows need approval.
- **Health-checked deploy with automatic rollback.** `deploy.sh` waits for the migration to exit 0. It then requires *both* API instances to answer through Caddy (proving the load balancer and both processes), plus the web app and the live service. If anything fails, it restarts the previous SHA and fails the run. Logs from the failing services are printed into the Actions log.
- **Migrations must be additive** (expand/contract) so a rollback can run on the newer schema. A destructive change ships in two releases.
- **Config bind mounts** (Caddyfile, SeaweedFS script) are copied *in place* into `~/glimpse/app`. Docker binds single files by inode, so replacing the file would leave the container on the old one. If one changed, its container is restarted.
- **Secrets** stay in `~/glimpse/.env` on the Mac (mode 600). `deploy.sh` refuses example values and an `APP_ORIGIN` that doesn't match the public URL.

**Tested here:** both scripts pass shellcheck, and the workflow passes actionlint. `deploy.sh` was exercised end to end with stand-in `docker`/`curl` commands: first deploy, normal deploy, a build that fails health checks (rolled back), a failed migration (rolled back), and refusal of a wrong `APP_ORIGIN` or an example secret. **Not yet run:** the workflow on GitHub and the runner on the Mac.

## D20. Abuse protection: token-bucket rate limits, Cloudflare in front, Turnstile on sign-in (added) ✅

The API has to be public: the frontend runs in each visitor's browser and calls it directly, so anything the app can send, curl can send too. Protection comes from **who** is asking (session + row-level security) and **how fast**, not from where the request comes from.

**Three layers:**
1. **Cloudflare, before anything reaches the Mac.** One rate-limiting rule on the free plan, which counts per IP over 10 seconds: block an IP that sends more than ~200 requests to `/api/` in 10 s, for 10 s. It's deliberately loose. In Pakistan whole neighbourhoods and mobile networks share an IP (carrier-grade NAT), so this is only a flood guard.
2. **The app, per account.** Token buckets in Redis, shared by both API instances (`lib/limits.ts`). Signed-in requests are counted per account, so logging in from 50 IPs doesn't give 50× the allowance and people sharing an IP don't eat each other's allowance. Logged-out requests are counted per IP.
3. **Turnstile** (Cloudflare's invisible "are you human" check) on sign-up always, and on login after 3 failures from an IP or for an account in 15 minutes. It's verified on the server, single-use, for the right action (a login token can't be used to sign up) and for this hostname.

**Why token buckets, not fixed windows:** a bucket starts full and refills steadily, so short bursts are fine (liking 15 posts while scrolling) but a script that keeps going runs dry. A fixed window (express-rate-limit's default) allows double the limit across the window boundary. All of a rule's buckets (e.g. comments: 20/hour *and* 200/day) are checked and spent in one Lua script, atomically, using Redis's clock so instances agree.

| Rule | Burst | Refill | Applies to |
|---|---:|---|---|
| engage | 30 | 1/s | like/unlike, save, repost, comment likes, story views |
| comment | 10 | 20/hour (+200/day) | new comments |
| follow | 20 | 60/hour (+200/day) | follow/unfollow, remove follower, accept/decline requests |
| publish | 10 | 30/hour | posts, shorts, stories, going live |
| upload | 30 | 120/hour | upload slots |
| message | 30 | 1/s | chat messages |
| write | 60 | 2/s | every other change (on top of the specific rule) |
| read | 120 | 5/s | every GET under /api |
| login | 10 | 10 per 15 min | per IP, **and** per account (hashed email) |
| register | 10 | 10/hour | per IP |
| oauth | 30 | 30 per 15 min | per IP |

**What the user sees:** `429` with `Retry-After` and a message that says how long to wait. The web app shows it in a toast and undoes the optimistic like.

**If Redis is unreachable:** each rule says. Likes, reads, posts and so on **fail open** (allowed), because a Redis blip shouldn't take the app down. Login, sign-up and Google sign-in **fail closed** (`503`), because that's what attackers target. Each check gives up after 500 ms.

**Where counters live:** on the queue Redis (AOF, `noeviction`), not the cache Redis. An evicted bucket would silently reset someone's limit.

**Trade-offs:**
- A per-account login limit lets someone lock a person out for up to 15 minutes by guessing wrong passwords. With Turnstile on, each guess costs them a solved challenge.
- `RATE_LIMIT_SCALE` multiplies every limit. It's 1 in production; tests and load tests raise it.

## D21. Likes at scale (added) ✅

What happens on a like, and what stops it falling over when many people like at once:
1. **Browser:** the heart and count change immediately (optimistic), then take the server's count. If the request fails or is rate-limited, they're undone.
2. **API, one transaction:**
   - Insert `(post, user)`; the primary key makes double taps, retries and two devices count once.
   - Row-level security checks you can see the post.
   - The outbox event is written in the same transaction.
   - **After commit**, the Redis count is incremented.
3. **Worker:** the notification, merged (below).

**Why simultaneous likes don't contend:** each like is its own row. There's no `like_count` column that every like would have to lock and update in turn. Redis runs one command at a time, so concurrent `HINCRBY`s never lose an update.

**One recount per hot post.** When a post's count hash expires, the first request recounts from Postgres and the rest wait for that result: in-process they share a promise, across instances a short Redis lock. Test: 60 simultaneous readers → 1 recount (8 without this).

**Merged notifications.** Likes and reposts are no longer one notification row (and one live push) per like:
- **One row per post per day.** It holds `actor_count` and the latest three names, so a viral post is one row: "leo and 4,182 others liked your post".
- **Counts people, not likes.** A HyperLogLog per post per day remembers who's been counted, so like → unlike → like is still one person. It uses at most 12 KB, has about 1% error, and expires after 2 days.
- **Exactly once.** The outbox event is marked `notified_at` in the same transaction as the merge, so a retried job finds it already done.
- **At most one live push per post per person every 5 seconds.**
- **Trade-off:** the merged row is itself a hot row on a viral post. Workers update it one at a time (row lock), which is fine at thousands per second. At Instagram scale you'd aggregate in memory and flush every second.

**Measured** (docs/v2/BENCHMARKS.md §3): about 230–260 likes/s sustained through Caddy and both API instances on a 2-vCPU sandbox that also runs Postgres, Redis and the load generator. Every count was correct, and thousands of like events became one notification row.

**What Instagram scale would add:**
- Likes go to a log first (Kafka, or Redis Streams, which Glimpse already uses), and are written in batches.
- The likes table is sharded by post.
- Very hot posts get a sharded counter, displayed rounded ("1.2M").
