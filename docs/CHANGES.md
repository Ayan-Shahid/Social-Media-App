# What changed from 2022, and how each part works

This is the guide to read before presenting the project. Every section says what the 2022 version did, what the new one does, and where to find it in the code.

## The big picture

| | 2022 | 2026 |
|---|---|---|
| Database | MongoDB (Mongoose) | PostgreSQL with row-level security |
| Backend | Express 4, JS-style TS | Express 5, strict TypeScript, Zod validation |
| Frontend | Create React App (discontinued), styled-components | Next.js 16, Tailwind 4, TanStack Query |
| Auth | JWT in local storage | Session cookie (httpOnly), hashed in the database |
| Chat | Plain text, anyone could send as anyone | End-to-end encrypted, authenticated |
| Uploads | Any file, saved under the name the user sent | Real type checked, re-encoded, random names |
| Deploy | Run `npm start` in two terminals | `docker compose up` |

The 2022 code is in `legacy/2022`. It's kept so you can show the before and after.

## Problems found in the 2022 code

1. **Unsafe upload:** `/api/upload` had no login check and saved files using `req.body.name`, a name the user chose. Anyone could upload anything, or overwrite existing files.
2. **Password hashes leaked:** login and register returned the whole user record, including the hash.
3. **Unauthenticated chat:** the Socket.IO server trusted whatever `userId` the client sent, so anyone could send messages as anyone.
4. **Committed dependencies:** `node_modules` (6,000+ files) was checked into git. It is now ignored.
5. **Other issues:** `PORT = 8000 || process.env.PORT` always used 8000, `removeUsers` didn't actually remove anything, and `cors()` allowed every site.

## Security features

### Row-level security (`apps/api/src/db/schema.ts`)

MongoDB has no row-level security. That's the main reason for switching to Postgres.

- The API connects as `glimpse_app`, a role that can't bypass RLS. Each request runs in a transaction that first sets `app.user_id` (see `asUser()` in `db/client.ts`).
- Every table has policies, written next to its definition. For example, messages can only be read by the two people in that conversation, and posts can only be inserted with your own id and your own media.
- Passwords and sessions live in tables the app role can't read at all. They're only reachable through a few `SECURITY DEFINER` functions (`migrations/0002_security.sql`).
- Column-level grants: the app can update a user's name and bio, but not their username.
- The tests connect straight to Postgres and try to read other people's messages, post as someone else, and so on. The database refuses.

### Migrations (`apps/api/migrations`)

Drizzle generates SQL files from the schema. The `migrate` container applies any new ones on every deploy, as the database owner, then exits. Applied migrations are recorded and skipped next time.

### CSRF (`apps/api/src/middleware/csrf.ts`)

Every request that changes something needs two checks:
1. **Origin check:** the `Origin` header must be this site. Another site can't fake it.
2. **Double-submit token:** the `X-CSRF-Token` header must match the CSRF cookie. Another site can't read the cookie, so it can't copy it into the header.

Session cookies are also `SameSite=Lax` and `httpOnly`.

### XSS

- React escapes everything it renders, and no user content is ever inserted as HTML.
- A strict Content Security Policy with a per-request nonce (`apps/web/src/proxy.ts`): only scripts Next.js added can run. An injected `<script>` is blocked by the browser.
- The API only returns JSON with `default-src 'none'`. Uploaded files are served with `nosniff` and a sandbox policy, so a file can never run as a page.

### Idempotency keys (`apps/api/src/middleware/idempotency.ts`)

"Create" actions (new post, comment, message, upload) need an `Idempotency-Key` header. The browser makes one key per action and reuses it on retry.
- **Same key again:** returns the first response; nothing is created twice.
- **Same key while the first is still running:** 409.
- **Same key with a different body:** 422.

Likes and follows use PUT and DELETE, which set a state, so repeating them is harmless by design.

### Upload sanitization (`apps/api/src/media/pipeline.ts`)

1. **Size limits** while receiving, and only one file per request.
2. **Real type check:** the type is read from the file's first bytes, ignoring the name and the type the browser claims. Only JPEG, PNG, WebP, GIF, HEIC, MP4, MOV and WebM pass.
3. **Re-encoding:** images through sharp to WebP, videos through ffmpeg to H.264 MP4. Only the decoded pixels and sound survive, so hidden scripts, appended data and metadata such as GPS location are removed.
4. **Safe storage:** random server-generated file names, served with fixed types.

The tests upload an HTML page renamed to .png, an SVG with a script, a Windows .exe renamed to .png, and a real PNG with a script appended. The first three are rejected, and the script in the fourth is stripped.

### End-to-end encrypted messages (`apps/web/src/lib/e2ee.ts`)

- On sign-up, the browser creates a key pair (X25519, libsodium). The public key goes to the server.
- The private key stays in the browser (IndexedDB). A backup is stored on the server, encrypted with a key derived from the password (Argon2id), so logging in on a new device unlocks it.
- Messages are encrypted with `crypto_box` before they're sent. The server stores and relays only ciphertext. The test checks the database holds no readable text.
- The safety code lets two people confirm no one swapped keys in between.

**About "the same standard Instagram uses":** Instagram's optional encrypted DMs (based on the Signal protocol) were discontinued on May 8, 2026, so Instagram DMs today are encrypted in transit and on Meta's servers, not end to end. Glimpse goes further than that: true end-to-end encryption with audited libsodium primitives.

The trade-off compared with the full Signal protocol, which WhatsApp uses: there's one key pair per user, so no forward secrecy (if a private key leaked, past messages could be read). Adding the Double Ratchet would be the next step.

### Also included

- Argon2id password hashing, with the same timing for unknown emails, so attackers can't tell which emails have accounts.
- Rate limits on login, sign-up, uploads and messages.
- Sessions stored as SHA-256 hashes: a database leak doesn't reveal usable session tokens.
- Live chat connections only accepted with a session cookie and from this site's origin.
- Keyset pagination, so the feed stays correct while new posts arrive.

## Design

The look is inspired by film cameras:
- **Date stamp:** each photo has its post date in the corner, in the orange dot-matrix style old point-and-shoot cameras printed.
- **Prints:** posts sit on a white mat like printed photos.
- **Contact sheet:** the profile grid looks like one.
- **Type:** Archivo (expanded) for headings, Instrument Sans for text, Doto for the date stamps. The fonts are bundled, not loaded from Google.

## Questions you might be asked

- **Why Postgres over MongoDB?** Real row-level security, transactions, and data that's relational: users, follows, likes, comments.
- **Why sessions instead of JWT?** You can log people out instantly, and nothing sensitive sits in local storage where an XSS bug could read it.
- **Can the server read messages?** No. It only has ciphertext. Only the two browsers hold the keys.
- **What happens if someone forgets their password?** Login could be reset, but old messages can't be decrypted. That's the cost of real end-to-end encryption.
- **How do you add a database change?** Edit `schema.ts`, run `npm run db:generate`, commit the SQL file. It's applied on the next deploy.

## v2 (later in 2026): the system-design layer

v1 made the app correct and secure on a single server. v2 makes it behave like a system that can grow. Each choice and its trade-off is in [v2/DECISIONS.md](v2/DECISIONS.md), with numbers in [v2/BENCHMARKS.md](v2/BENCHMARKS.md). In short:

- **Nothing slow happens in a request.** Uploads return `202 Accepted`. A worker validates, re-encodes (WebP sizes, HLS for video) and announces the result over the websocket.
- **Events can't get lost.** Database changes and their events are written in one transaction (transactional outbox). A relay hands them to BullMQ, and consumers are idempotent (job id = event id), so a retry never double-notifies.
- **Feed reads are one Redis call.** Posts are pushed into followers' feed lists at write time, except for accounts with huge followings, which are merged in at read time (hybrid fan-out, like Twitter's).
- **Caching with a plan.** Cache-aside with single-flight locks (no stampedes), negative caching, normalized entries (one `user:{id}` key, never copies inside posts), and write-through counters with drift repair. Per-viewer data ("did I like this?") is never cached.
- **Two API instances behind Caddy.** No sticky sessions. You can stop either instance under load and requests keep succeeding.
- **Google sign-in.** OIDC with PKCE, state and nonce. Accounts are only linked when Google says the email is verified.
- **Group chats stay end-to-end encrypted.** There's a group key per "epoch", sealed for each member, and a new key whenever someone joins or leaves.
- **Interface.** One WebGL shader paints both the background and the card surfaces. Buttons use grainy mesh-gradient textures, and there are animations for liking, posting ("developing" photos), and new messages.

### More questions you might be asked

- **Why an outbox instead of publishing to the queue after commit?** If the process dies between commit and publish, the event is gone. If you publish before commit and the transaction rolls back, you've announced something that never happened. The outbox makes the event part of the same commit.
- **Why not fan out every post?** An account with 10 million followers would mean 10 million writes per post. Above a threshold, it's cheaper to merge their recent posts in when a follower reads.
- **Why two Redis instances?** Different failure rules. A cache may lose anything at any time; a queue must lose nothing. One instance can't be both `allkeys-lru` and `noeviction`.
- **What happens when someone leaves a group chat?** They knew the current key, so the next message must use a new one. The server flags the group, and the next member to send creates and distributes a fresh key first.
