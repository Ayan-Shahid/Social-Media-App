# Glimpse v2 design decisions

One entry per decision, in the style of an architecture decision record. Each one gives the problem, the realistic options and their trade-offs. **The "Decision" and "Why" lines are blank on purpose: they're yours to fill in.** In an interview, this file is the proof that you made these calls.

There's rarely one correct answer. A good entry names the option, the reason, and what you're giving up.

---

## D1. Redis: one instance, and what happens when it loses data

**Context:** Redis will hold cache, feeds, queues, pub/sub and rate limits. These have very different needs. Losing cache is harmless, but losing queued jobs is not.

| Option | For | Against |
|---|---|---|
| One Redis, AOF persistence on, `noeviction` | Simple; queues are safe | A full cache stops writes instead of evicting |
| One Redis, `allkeys-lru`, no persistence | Ideal for cache | Evicts or loses queue jobs: wrong for BullMQ |
| Two Redis: `redis-cache` (LRU, no persistence) + `redis-queue` (AOF, `noeviction`) | Each tuned for its job | One more container on a small Mac |

Hint: BullMQ documents that it needs `maxmemory-policy noeviction`.

**Decision:**
**Why:**
**What you're giving up:**

## D2. Message queue technology

**Context:** background jobs for media, fan-out, notifications and cleanup. Needs retries, backoff, delays, a failed-job view, and concurrency limits.

| Option | For | Against |
|---|---|---|
| BullMQ (Redis) | Mature Node library, retries, delays, priorities, dashboard; reuses Redis | Redis must persist; not a log you can replay |
| pg-boss / Postgres `SKIP LOCKED` | No new infra; jobs in the same transaction as data, so no outbox needed | Load on the main database; fewer features |
| RabbitMQ | True broker, routing, dead-letter exchanges | Another service to run and learn |
| Kafka / Redpanda | Replayable event log, huge scale | Heavy for one Mac; overkill at this size, which you should be able to explain |

**Decision:**
**Why:**
**What you're giving up:**

## D3. Feed fan-out threshold

**Context:** fan-out on write is fast to read but expensive for accounts with many followers. Fan-out on read is cheap to write but slow to read.

Questions to answer:
- At how many followers does an account switch to pull? (Instagram/Twitter-style systems use a threshold.) What number did you pick and how did you test it?
- How long is each timeline (how many ids)? What happens when someone scrolls past it?
- Inactive users: do you still push into their timelines, or rebuild when they come back?

**Decision:**
**Why:**
**What you're giving up:**

## D4. Caching strategy and invalidation

**Context:** posts and profiles are read far more than written. But Glimpse uses row-level security, and a shared cache sits outside it.

Decide each of these:
1. **Pattern:** cache-aside (read: cache, then DB; write: DB, then delete key), write-through, or write-behind?
2. **Invalidation:** delete on write, TTL only, or versioned keys (`post:{id}:v{n}`)?
3. **Stampede protection:** single-flight lock (`SET NX PX`), probabilistic early expiration, or a short stale-while-revalidate window?
4. **What's safe to share:** list which fields go into shared cache entries and which are per-viewer. For example, `likedByMe` must never be shared. Where do per-viewer fields come from instead?
5. **Negative caching:** do you cache "not found"? For how long?

**Decision:**
**Why:**
**What you're giving up:**

## D5. Getting events from the database to the queue

**Context:** a post and its "post created" event must either both happen or neither.

| Option | For | Against |
|---|---|---|
| Transactional outbox + polling relay | Simple, reliable, easy to reason about | Polling delay; relay must handle duplicates |
| Outbox + Postgres `LISTEN/NOTIFY` to wake the relay | Near-instant | Notifications are lost if nobody's listening, so still poll as a backup |
| Change data capture (Debezium reading the WAL) | No outbox writes in code | Kafka Connect stack: too heavy here |
| Enqueue directly after commit | Least code | Crash between commit and enqueue loses the event: the problem you're solving |

**Decision:**
**Why:**
**How consumers stay idempotent:**

## D6. Google sign-in, account linking and chat keys

**Context:** message keys are currently locked with the user's password. Google users don't have one.

Part A, linking: a Google login arrives with an email that already has a password account.
- Auto-link only if `email_verified` is true?
- Or require them to log in with the password first, then link?
- What's the account-takeover risk with each?

Part B, chat keys for Google users:

| Option | For | Against |
|---|---|---|
| Separate chat passcode (Argon2id-wrapped backup, like now) | Works on any device; same code path | One more thing to remember |
| Device-only keys + approve new devices from an existing one (QR, like WhatsApp linked devices) | Strongest; no secret on the server | Much more work; losing all devices loses history |
| Server-held key | Easiest | Not end-to-end encryption anymore. Say so if you choose it |

**Decision:**
**Why:**
**What you're giving up:**

## D7. Group chat encryption

**Context:** 1:1 uses `crypto_box` between two key pairs. Groups need every member to read, and ex-members not to.

| Option | For | Against |
|---|---|---|
| Pairwise: encrypt each message once per member | Reuses 1:1 code; simple | Message size and work grow with group size |
| Group key wrapped for each member, rotated on join and leave | One ciphertext per message; easy to explain | No forward secrecy within an epoch; rotation logic |
| Signal-style sender keys | What WhatsApp groups use | Harder; needs a ratchet |
| MLS (RFC 9420) | The modern standard for group E2EE | Very heavy for this project |

Also decide: maximum group size, and whether new members see history.

**Decision:**
**Why:**
**What you're giving up:**

## D8. Media processing and delivery

Decide:
- Video: HLS ladder (which renditions?) or single MP4 for regular posts and HLS only for shorts?
- Worker concurrency on the 2018 MacBook. ffmpeg will use every core; how many jobs at once?
- Where originals live after processing: deleted, kept privately, or moved to object storage (MinIO, S3-compatible) as a later step?
- Image sizes: which widths, and how does the client pick (`srcset`)?

**Decision:**
**Why:**

## D9. Like and comment counters

| Option | For | Against |
|---|---|---|
| `count(*)` on read (now) | Always exact | Slow on hot posts |
| Counter column updated in the same transaction | Exact, fast reads | Row lock contention on viral posts |
| Redis `INCR`, flushed to Postgres periodically | Very fast, no contention | Can drift; must handle Redis loss |
| Cached `count(*)` with short TTL | Simple | Slightly stale |

**Decision:**
**Why:**
**How you'd repair drift:**

## D10. Card surface shader

**Context:** browsers allow only about 16 WebGL contexts per page. A feed has many cards.

| Option | For | Against |
|---|---|---|
| One fullscreen canvas behind everything; pass the visible cards' rectangles as uniforms, and the shader draws "card material" inside them | One context; background and cards in one pass | Must sync rectangles on scroll and resize every frame |
| One shared offscreen canvas, copied into each card with `drawImage` | Simple per-card visuals | Copying cost; still one context |
| Render a short looping texture once and use it as a CSS background | Cheapest | Not a live shader |
| Canvas per card | Easiest to write | Breaks past about 16 cards: should be rejected, and you should be able to say why |

**Decision:**
**Why:**

## D11. Real-time across instances

- Socket.IO with long-polling needs sticky sessions (requests from one client must hit the same instance). Do you enable stickiness in Caddy, or force `transports: ["websocket"]`?
- Redis pub/sub adapter vs Redis Streams adapter: what happens to events during a short disconnect with each?
- Where does presence live, and how do stale "online" entries expire if an instance crashes?

**Decision:**
**Why:**
