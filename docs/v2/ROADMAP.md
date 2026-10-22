# Glimpse v2 roadmap

The goal of v2: turn Glimpse from a working app into a system that shows real backend engineering. Every piece of infrastructure here exists because of a concrete problem in the current code, not to tick a box. If you can't name the problem a component solves, leave it out.

How to use this:
1. Before each milestone, fill in the matching decisions in [DECISIONS.md](DECISIONS.md). Choose, and write down why.
2. Build it. Keep each milestone on its own branch and PR, so the history shows how the system grew.
3. Check the "Done when" list. Measure, don't assume.
4. Answer the "Be ready to explain" questions out loud. If you can't, you're not done.

```
                 ┌──────────── Caddy (sticky for /socket.io) ────────────┐
browser ─tunnel─▶│                                                       │
                 ├─▶ web (Next.js)                                       │
                 ├─▶ api #1 ─┐                                           │
                 └─▶ api #2 ─┼──▶ Postgres (source of truth, RLS, outbox)│
                             │        │                                  │
                             └──▶ Redis ◀── relay ── outbox table        │
                                   ├ cache (cache-aside, counters)       │
                                   ├ feeds (sorted sets)                 │
                                   ├ pub/sub (Socket.IO adapter)         │
                                   ├ rate limits                         │
                                   └ queues (BullMQ) ──▶ workers ×N      │
                                                          ├ media (ffmpeg, HLS)
                                                          ├ fan-out
                                                          ├ notifications
                                                          └ cleanup (stories)
```

---

## M0. Foundation: Redis, workers, outbox

**Problem it solves:** today everything happens inside the HTTP request. Slow or failing side effects (transcoding, notifications) either block the user or get lost.

Build:
- Add `redis` to `docker-compose.yml` with a memory limit and `maxmemory-policy` (see decision D1).
- A separate `worker` service: same image as the API, different entry point (`dist/worker.js`). It must never serve HTTP.
- An `outbox` table: `id, type, payload jsonb, created_at, published_at`. Routes insert events into it in the same transaction as the data change.
- A relay that reads unpublished rows (`FOR UPDATE SKIP LOCKED`), puts them on the queue, and marks them published.
- Queue dashboard (Bull Board, or similar) behind a staff-only route, plus structured logs with a request id that follows a job from API to worker.

Done when:
- [ ] You kill the worker, create 5 posts, start the worker again, and all 5 events are processed. Nothing is lost.
- [ ] A job that throws is retried with backoff, then ends in a failed or dead-letter state you can see and replay.
- [ ] The same event delivered twice doesn't cause a double effect. Consumers are idempotent.

Be ready to explain:
- Why not just call `queue.add()` inside the route? (Hint: what if the transaction rolls back after the job was queued, or the process crashes between commit and enqueue?)
- What does "at-least-once delivery" mean for how you write consumers?
- What happens if Redis loses data on restart? Which parts are fine and which aren't?

## M1. Async media pipeline + shorts

**Problem it solves:** a video upload currently holds the request open for up to 3 minutes while ffmpeg runs. Two big uploads at once can starve the API.

Build:
- Upload flow: API validates the magic bytes, stores the original in a private `uploads/` area, creates `media` with `status = processing`, and enqueues a job. It responds immediately with `202`.
- The worker transcodes. Images go to WebP in several sizes. Videos go to an HLS ladder (for example 360p, 720p, 1080p) with a poster. The worker then sets `status = ready` or `failed`.
- The client sees progress over the socket (`media:status`) and only lets you publish once the media is `ready`.
- Shorts: posts flagged `kind = short` (vertical video, 60s max), a full-screen vertical feed, played with `hls.js` (Safari plays HLS natively).
- Job concurrency limited to fit a 2018 MacBook (decision D8).

Done when:
- [ ] Uploading a 60s video returns in under 1 second, and the post appears once processing finishes.
- [ ] The network tab shows the player switching quality levels when you throttle the connection.
- [ ] A corrupt video ends as `failed` with a clear message, and the worker keeps going.

Be ready to explain: why HLS instead of one MP4, what an encoding ladder is, why transcoding belongs in a worker and not the API, and how you'd scale it (more workers, or a GPU box).

## M2. Home feed with hybrid fan-out

**Problem it solves:** the feed query (`author in (people I follow)`, sorted by time) gets slower as follows and posts grow. It runs on every scroll.

Build:
- Each user's timeline is a Redis sorted set `feed:{userId}` (score = timestamp, member = postId), capped at around 800 entries.
- Fan-out on write: when a normal user posts, a job adds the post id to each follower's timeline.
- Fan-out on read for very popular accounts: above a follower threshold (decision D3), their posts are merged in when the feed is read.
- Follow: backfill recent posts. Unfollow, delete or block: filter at read time, then clean up in the background.
- Cold start: if a timeline is missing (Redis restarted, new user), rebuild it from Postgres.

Done when:
- [ ] A seed script creates 10,000 users and one account with 50,000 followers. Posting as that account doesn't enqueue 50,000 writes.
- [ ] Feed reads stay fast (record p95 with k6 before and after; see M4).
- [ ] Flushing Redis doesn't break the feed. It rebuilds.

Be ready to explain: push vs pull vs hybrid, where you set the threshold and why, and what "eventually consistent" means for a feed.

## M3. Caching layer

**Problem it solves:** every post card runs four subqueries (counts, liked-by-me). Hot posts are read thousands of times more than they change.

Build:
- Cache-aside for post and profile objects (`post:{id}`), with a TTL and explicit invalidation on update or delete.
- Like and comment counters kept in Redis (decision D9), with Postgres staying the source of truth.
- Per-viewer data (`likedByMe`, `isFollowing`) is **not** stored in shared cache entries (see the warning below).
- Stampede protection for hot keys: single-flight lock or early expiration (decision D4).
- Cache hit rate exposed as a metric.

Warning: Glimpse uses row-level security. A shared cache sits **outside** RLS. If a cached object ever contains something only one viewer may see, another viewer will get it. Decide what's safe to share, and write that down in D4.

Done when:
- [ ] Hit rate above 90% under the k6 read test, measured, not assumed.
- [ ] Deleting a post removes it from every cached view within a second.
- [ ] 500 concurrent requests for one cold key cause one database query, not 500.

## M4. Scale out: two API instances, pub/sub, shared limits

**Problem it solves:** live chat and rate limits currently live in one process's memory. A second API instance would miss messages and double everyone's rate limit.

Build:
- Run `api` with 2 replicas behind Caddy.
- Socket.IO Redis adapter (pub/sub) so an event emitted on instance 1 reaches users connected to instance 2.
- Presence (who's online) moved into Redis with expiring heartbeats.
- Shared rate limiting in Redis.
- Load tests with k6 and a short `docs/v2/BENCHMARKS.md` with real numbers: before and after caching, 1 vs 2 instances.

Done when:
- [ ] Two browsers, each pinned to a different instance, chat live.
- [ ] Killing one API instance mid-chat reconnects the client to the other within seconds.
- [ ] The login rate limit holds across both instances.

Be ready to explain: why Socket.IO needs sticky sessions with long-polling (or websocket-only), and pub/sub vs streams (what happens to events while a node is briefly disconnected).

## M5. Google sign-in

Build:
- OAuth 2.0 authorization code flow with PKCE, `state` and `nonce`. Verify the ID token: issuer, audience, expiry and nonce.
- `oauth_accounts` table (provider, provider user id, user id). One user can have a password and Google linked.
- Linking rule: only auto-link to an existing account if Google says `email_verified = true` (decision D6).
- Encrypted chat for Google users: they have no password to lock their message key with (decision D6).

Done when:
- [ ] Sign up with Google, log out, log in with Google: same account.
- [ ] Tampering with `state` or replaying a code fails.
- [ ] A Google user can read their messages on a second browser.

## M6. Product features

Each of these should reuse the pipelines above rather than adding new special cases.

| Feature | Data | Uses |
|---|---|---|
| Carousels (up to 10 photos or videos) | `post_media (post_id, media_id, position)` | M1 pipeline |
| Saved posts + collections | `collections`, `saved_posts`; private, RLS owner-only | RLS |
| Reposts | `reposts (user_id, post_id)`; shown in followers' feeds | M2 fan-out |
| Mentions | parsed on the server; `mentions (post_id/comment_id, user_id)` | outbox, notifications |
| Hashtags | `hashtags`, `post_hashtags`; trending in a Redis sorted set with time decay | M3 Redis |
| Notifications | `notifications`, grouped ("leo and 4 others liked your post"), live over the socket | outbox, workers, pub/sub |
| Stories | `expires_at` 24h after posting; story tray in Redis; cleanup job deletes expired media | M1 + scheduled jobs |

Render mentions and hashtags by splitting text into tokens and making React elements. Never build HTML strings, or you reopen XSS.

## M7. Encrypted group chats

Hardest milestone. Read decision D7 first. Whatever you choose, these must be true and tested:
- [ ] A member who leaves can't read messages sent after they left (keys rotate on membership change).
- [ ] A new member can't read messages from before they joined, unless you deliberately decide otherwise.
- [ ] The server still only ever sees ciphertext.

## M8. Interface

- **Background:** one WebGL shader on a single fixed canvas. Pause when the tab is hidden, cap the device pixel ratio (a 2018 MacBook GPU will thank you), and show a static image when `prefers-reduced-motion` is on or WebGL fails.
- **Card surfaces:** browsers cap WebGL contexts at about 16 per page, so a canvas per card breaks on a long feed. See decision D10.
- **Buttons:** grainy mesh-gradient WebP backgrounds made by a script (blurred colour blobs plus noise, exported at 2x), a flat 1px border, and no shadows or bevels. States: default, hover, pressed, focus-visible, disabled, loading, each with a short transition.
- **Motion:** a heart burst on like (also on double-tap of a photo), and a "developing" effect when a post is published: the photo fades in from a pale, low-contrast state like an instant print. Respect reduced motion.
- Keep the CSP strict. Shaders need no `unsafe-eval`.

---

## Suggested order and effort

Rough guide for one person learning as they go: M0 3–4 days, M1 4–5, M2 3–4, M3 2–3, M4 3, M5 2, M6 5–7, M7 5+, M8 4–5. That's several weeks of work, and that's normal for this scope.

If you need something to show early, M0 + M1 + this design work (with your decisions filled in) already demonstrates queues, workers, the outbox pattern and an async media pipeline, which is more than most portfolio projects.
