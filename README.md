# Glimpse

A photo and video sharing app with end-to-end encrypted direct messages.

Originally built in 2022 with the MERN stack (kept in [`legacy/2022`](legacy/2022) for comparison), rebuilt in 2026 with Postgres, row-level security, and a security-first API. See [docs/CHANGES.md](docs/CHANGES.md) for what changed and why.

## Features

- Sign up and log in (Argon2id passwords, httpOnly session cookies)
- Post photos and short videos with captions, a feed of people you follow, explore, profiles
- Follow, like, comment, delete your own posts and comments
- End-to-end encrypted 1:1 messages with live delivery, online status and a safety code
- Edit profile: name, bio, photo

## Stack

| Part | Tech |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query |
| API | Node.js 24, Express 5, TypeScript, Socket.IO, Zod |
| Database | PostgreSQL 18, Drizzle ORM and migrations, row-level security |
| Media | sharp (images), ffmpeg (video), file-type (magic-byte detection) |
| Encryption | libsodium (X25519, XSalsa20-Poly1305, Argon2id) |
| Deploy | Docker Compose, Caddy, Cloudflare Tunnel |

```
browser ──▶ Cloudflare Tunnel ──▶ Caddy ──┬─▶ web  (Next.js pages)
                                          └─▶ api  (/api, /media, /socket.io) ──▶ Postgres
```

## Run it with Docker (recommended)

Only Docker Desktop is needed on the host. No Node, Postgres or ffmpeg to install.

```bash
cp .env.example .env          # set the two passwords (letters and numbers only)
docker compose up -d --build  # first build takes a few minutes
```

Open http://localhost:8090. The `migrate` service applies the database schema automatically and exits.

### Put it online with a Cloudflare Tunnel

Glimpse gets its own tunnel, so it never touches another app's tunnel.

1. In Cloudflare Zero Trust, go to **Networks > Tunnels > Create a tunnel** (Cloudflared). Copy the token.
2. Add a **public hostname**, for example `glimpse.yourdomain.com`, with service **HTTP** and URL **`proxy:80`**.
3. In `.env`, set `CLOUDFLARE_TUNNEL_TOKEN=<token>` and `APP_ORIGIN=https://glimpse.yourdomain.com`.
4. Run `docker compose --profile tunnel up -d --build`.

`APP_ORIGIN` must match the address in the browser exactly. It's used for the CSRF check and for secure cookies.

### Useful commands

```bash
docker compose logs -f api            # API logs
docker compose ps                     # what's running
docker compose down                   # stop (data is kept in Docker volumes)
docker compose up -d --build          # update after pulling new code (runs new migrations)
```

## Develop without Docker

Needs Node 22+, Postgres 16+ and ffmpeg.

```bash
# API
cd apps/api && npm install
MIGRATION_DATABASE_URL=postgres://postgres@localhost/glimpse APP_DB_PASSWORD=devpass npm run migrate:dev
DATABASE_URL=postgres://glimpse_app:devpass@localhost/glimpse APP_ORIGIN=http://localhost:3000 npm run dev

# Web (another terminal)
cd apps/web && npm install && npm run dev     # http://localhost:3000
```

Tests (API, against a real Postgres): `cd apps/api && npm test`. They cover CSRF, idempotency, upload attacks, row-level security and encrypted messaging.

## Database changes

Edit `apps/api/src/db/schema.ts`, then:

```bash
cd apps/api && npm run db:generate   # writes a new SQL file in migrations/
```

Commit the new file. It's applied on the next `docker compose up`. If a new table needs permissions for the app role, add a `GRANT` in a custom migration (`npx drizzle-kit generate --custom`).
