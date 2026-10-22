# Glimpse

A photo and video sharing app: feed, stories, shorts, live video, reposts, saved collections, mentions and hashtags, notifications, private accounts, and end-to-end encrypted direct and group messages. Light and dark themes over a WebGL background that reacts to what you do.

Originally built in 2022 with the MERN stack (kept in [`legacy/2022`](legacy/2022) for comparison), then rebuilt in 2026 in two steps:
- **v1:** Postgres with row-level security and a security-first API ([docs/CHANGES.md](docs/CHANGES.md)).
- **v2:** the system-design layer. Redis caching, queues and background workers, a fan-out feed, two load-balanced API instances, and Google sign-in.

The v2 decisions and their trade-offs are in [docs/v2/DECISIONS.md](docs/v2/DECISIONS.md), with measurements in [docs/v2/BENCHMARKS.md](docs/v2/BENCHMARKS.md).

## Features

- **Posts:** photo carousels (up to 10), captions with @mentions and #hashtags, likes, comments, reposts, saves into collections
- **Shorts:** vertical videos, transcoded to adaptive HLS (360p/720p)
- **Stories:** expire after 24 hours, with seen rings and a viewer list for the author; reply or react (❤️ 😂 😮 😢 👏 🔥) into an encrypted DM
- **Live video:** go live from the browser camera; followers get notified and a live ring in their tray; live comments, hearts and viewer count
- **Feeds:** home feed of people you follow (and their reposts), explore, a page per hashtag, trending tags
- **Notifications:** grouped ("bea and 3 others liked your post"), delivered live
- **Messages:** end-to-end encrypted 1:1 and group chats (up to 32), with live delivery, online status and safety codes; share posts into chats
- **Privacy:** private accounts with follow requests, remove a follower, block, mute
- **Accounts:** email and password, or Continue with Google
- **Ops page:** live cache hit rates, queue depths, and which API instance answered (admins only)
- **Look:** light and dark themes (follows the system, or pick one), a pre-rendered shader background of social icons, grid-paper cards, grainy mesh-gradient buttons, hearts that float up when you like, a 3D film camera on the landing and sign-in pages
- **Landing page** at `/welcome` with live counts from this server (nothing made up)

## Stack

| Part | Tech |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, hls.js, three.js (3D camera) |
| API | Node.js 24, Express 5, TypeScript, Socket.IO, Zod |
| Database | PostgreSQL 18, Drizzle ORM and migrations, row-level security |
| Cache, queues | Redis 8 ×2 (cache: LRU, no persistence; queues: AOF, no eviction), BullMQ, Redis Streams |
| Media | sharp (images → WebP), ffmpeg (video → HLS, live → HLS), file-type (magic-byte detection) |
| Object storage | SeaweedFS (S3 API) with signed direct uploads; works with R2 or S3 too |
| Live video | MediaRecorder → WebSocket → ffmpeg → HLS, hls.js |
| Encryption | libsodium (X25519, XSalsa20-Poly1305, Argon2id) |
| Deploy | Docker Compose, Caddy (load balancer), Cloudflare Tunnel |

```
                                     ┌─▶ web (Next.js)
browser ─▶ Cloudflare Tunnel ─▶ Caddy ┼─▶ api-1, api-2 (round-robin, health-checked) ──▶ Postgres (RLS)
                                     ├─▶ live (camera WebSocket in, HLS out)              │ outbox
                                     └─▶ storage (GET /media/*, signed PUT /uploads/*)    ▼
                                              ▲                     relay ─▶ BullMQ (redis-queue) ─▶ worker
                                              └──────────────── worker writes processed media ◀──┘
   redis-cache: cache, rate limits, presence    ·    redis-queue: jobs + realtime event stream
```

How a post travels: the API writes the post **and** an outbox event in one transaction, and returns. The relay moves the event to a queue. The worker pushes the post id into each follower's feed in Redis (or skips accounts with huge followings, which are merged in at read time). Then it sends notifications, which reach the browser over the websocket of whichever API instance the recipient is connected to.

## Run it with Docker (recommended)

Only Docker Desktop is needed on the host. No Node, Postgres or ffmpeg to install.

```bash
cp .env.example .env          # set the four secrets (letters and numbers only)
docker compose up -d --build  # first build takes a few minutes
```

Open http://localhost:8090. The `migrate` service applies the database schema automatically and exits.

The whole stack is limited to about 3.8 GB of memory (see `deploy.resources` in `docker-compose.yml`), so it can run next to other apps.

**Optional settings in `.env`:**
- `ADMIN_USERNAMES=yourname`: shows the **Ops** page and the queue dashboard (`/admin/queues`) to that account.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: turn on Continue with Google. In Google Cloud Console, create an OAuth client (Web application) with the redirect URI `<APP_ORIGIN>/api/auth/google/callback`.
- `FANOUT_THRESHOLD=3`: makes the "celebrity" pull path kick in for small demos.

### Put it online with a Cloudflare Tunnel

Glimpse gets its own tunnel, so it never touches another app's tunnel.

1. In Cloudflare Zero Trust, go to **Networks > Tunnels > Create a tunnel** (Cloudflared). Copy the token.
2. Add a **public hostname**, for example `glimpse.yourdomain.com`, with service **HTTP** and URL **`proxy:80`**.
3. In `.env`, set `CLOUDFLARE_TUNNEL_TOKEN=<token>` and `APP_ORIGIN=https://glimpse.yourdomain.com`.
4. Run `docker compose --profile tunnel up -d --build`.

`APP_ORIGIN` must match the address in the browser exactly. It's used for the CSRF check and for secure cookies.

### Useful commands

```bash
docker compose logs -f api-1 api-2    # API logs
docker compose logs -f worker         # background jobs
docker compose stop api-1             # watch Caddy route everything to api-2
docker compose ps                     # what's running
docker compose down                   # stop (data is kept in Docker volumes)
docker compose up -d --build          # update after pulling new code (runs new migrations)
```

## Develop without Docker

Needs Node 22+, Postgres 16+, Redis (two instances on 6380 and 6381), ffmpeg, and any S3 API on 8333 (SeaweedFS, or `moto_server` for a quick in-memory one).

```bash
# API
cd apps/api && npm install
MIGRATION_DATABASE_URL=postgres://postgres@localhost/glimpse APP_DB_PASSWORD=devpass WORKER_DB_PASSWORD=workerpass npm run migrate:dev
DATABASE_URL=postgres://glimpse_app:devpass@localhost/glimpse APP_ORIGIN=http://localhost:3000 npm run dev
# Worker and live service (other terminals)
WORKER_DATABASE_URL=postgres://glimpse_worker:workerpass@localhost/glimpse DATABASE_URL=... npx tsx src/worker.ts
DATABASE_URL=... npx tsx src/live.ts

# Web (another terminal)
cd apps/web && npm install && npm run dev     # http://localhost:3000
```

Tests (API, against real Postgres, Redis and an S3 API, e.g. `moto_server -p 4566`): `cd apps/api && npm test`. The 95 tests cover:
- **Security:** CSRF, idempotency, upload attacks, row-level security, encrypted messaging.
- **System behaviour:** outbox reliability, idempotent consumers, fan-out push and pull, cache stampedes, counter drift, and cross-instance delivery with two real API processes.
- **Features**, and **Google sign-in** against a mock identity provider.
- **Privacy:** private accounts, requests, blocks, mutes, and that the shared caches never leak across viewers.
- **Live video:** a real stream through the live service and ffmpeg, access control, and the comment room.
- **Swapping ids (IDOR):** another user tries every id-taking route against someone else's media, posts, comments, collections, chats, stories, lives and follow requests; plus a scan proving the shared Redis cache holds nothing private.

### What hasn't been run yet

The build machine couldn't reach Docker Hub or GitHub releases, so these were checked by other means. They need a first real run on the Mac:
- **`docker compose up` itself.** Each service ran as a plain process behind the same Caddy config.
- **SeaweedFS.** Storage was tested against `moto`, an S3 emulator. The SeaweedFS identity config (`deploy/seaweedfs.sh`) is written from its docs, but hasn't been exercised.
- **Playback of H.264 video in Chrome and Safari.** The test browser has no H.264 decoder, so HLS output was verified with ffprobe instead.
- **Live from Safari.** Its MediaRecorder sends MP4 rather than WebM; ffmpeg reads both, but it's untested.

## Database changes

Edit `apps/api/src/db/schema.ts`, then:

```bash
cd apps/api && npm run db:generate   # writes a new SQL file in migrations/
```

Commit the new file. It's applied on the next `docker compose up`. If a new table needs permissions for the app role, add a `GRANT` in a custom migration (`npx drizzle-kit generate --custom`).
