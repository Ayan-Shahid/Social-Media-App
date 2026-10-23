# Deploying Glimpse to the MacBook (glimpse.ayandev.app)

```
 git push to main
      │
      ▼
 GitHub-hosted runners (Ubuntu)                         your MacBook Pro 2018 (Intel)
 ┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────────┐
 │ API tests: Postgres, 2x Redis, S3, ffmpeg │          │ self-hosted runner (label: glimpse)           │
 │ web typecheck + build                     │  green   │   deploy/deploy.sh <sha>                      │
 │ compose / Caddy / shellcheck              │ ───────▶ │   pull images for <sha> from GHCR             │
 │ build linux/amd64 images → GHCR :<sha>    │          │   migrate → start → health-check → or roll back│
 └──────────────────────────────────────────┘          └───────────────┬──────────────────────────────┘
                                                                        │ docker compose (project "glimpse")
 visitor ─▶ Cloudflare (glimpse.ayandev.app) ─▶ Cloudflare Tunnel ─▶ Caddy :8090 ─▶ web / api-1 / api-2 / live / storage
```

**Why it's built this way:**
- **Nothing is compiled on the Mac.** GitHub's servers run the tests and build the Docker images (for `linux/amd64`, which an Intel MacBook runs natively), tagged with the commit SHA. The Mac only downloads finished images, so a deploy takes a minute or two instead of a long build competing with Veritas for CPU.
- **The Mac never runs untrusted code.** Pull requests, including ones from strangers' forks, only ever run on GitHub's machines. The Mac's runner is used by exactly one job: the deploy, for pushes to `main` of this repository, inside the `production` environment.
- **Secrets never leave the Mac.** They live in `~/glimpse/.env` and nowhere else: not in git, not in GitHub.
- **A bad deploy undoes itself.** If the new version doesn't pass its health checks, the previous version is started again and the Actions run goes red.

Allow about an hour the first time. After that, deploying is `git push`.

---

## 1. Prepare the Mac (once)

1. **Docker Desktop** (Intel/"Apple chip: no" download). In Settings:
   - **General → Start Docker Desktop when you sign in**: on.
   - **Resources → Memory**: at least **8 GB** (Glimpse is capped at ~3.8 GB, plus Veritas). If the Mac has 16 GB, 10 GB is comfortable.
2. **Keep the Mac awake and logged in.** The runner and Docker Desktop run in your user session, so a sleeping or logged-out Mac means no deploys and no website.
   - System Settings → **Energy Saver/Battery → Power Adapter**: "Prevent automatic sleeping when the display is off": on.
   - Or in Terminal: `sudo pmset -c sleep 0 disksleep 0`. The display can still turn off.
   - System Settings → **Users & Groups → Automatically log in as**: your user, so a power cut or reboot comes back up on its own. (FileVault must be off for automatic login. Keep it on if you prefer, and log in by hand after a reboot.)
3. **Command line tools** (git, used by the runner): `xcode-select --install`.

## 2. Cloudflare: the domain and the tunnel

`ayandev.app` must already be a site in your Cloudflare account.

**Option A (recommended): Glimpse gets its own tunnel.** Then Glimpse and Veritas can't break each other.
1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → Cloudflared → name it `glimpse-macbook`.
2. On the install step, **don't run the commands it shows**. Just copy the **token**: the long string after `--token`. Glimpse runs `cloudflared` itself in Docker.
3. **Public Hostname** tab → Add:
   - **Subdomain** `glimpse`, **Domain** `ayandev.app`
   - **Service type** `HTTP`, **URL** `proxy:80`. That's the Caddy container's name inside Glimpse's Docker network.
4. Put the token in `~/glimpse/.env` (next step) as `CLOUDFLARE_TUNNEL_TOKEN`. When it's set, `deploy.sh` also starts the tunnel container.

**Option B: add a hostname to Veritas's existing tunnel.** In that tunnel → Public Hostname → Add `glimpse.ayandev.app`:
- Service `HTTP`, URL **`host.docker.internal:8090`** if Veritas's `cloudflared` runs in Docker, or **`localhost:8090`** if it runs directly on the Mac.
- Leave `CLOUDFLARE_TUNNEL_TOKEN` empty in Glimpse's `.env`.

**Cloudflare settings that matter for this app** (dashboard → ayandev.app):

| Setting | Value | Why |
|---|---|---|
| SSL/TLS → Overview | **Full** | Browser ↔ Cloudflare is HTTPS; the tunnel itself is encrypted. |
| Speed → Optimization → **Rocket Loader** | **Off** | It rewrites `<script>` tags, which breaks the app's strict Content-Security-Policy (nonces). The page would load blank. |
| Scrape Shield → **Email Address Obfuscation** | **Off** | It injects a script that the CSP blocks (console errors). |
| Network → **WebSockets** | **On** | Chat, notifications, presence and live-video ingest are WebSockets. |
| Caching → Cache Rules | **Bypass cache** when *URI Path starts with* `/api/`, `/socket.io/`, `/stream/` or `/uploads/` | API responses, live playlists and uploads must never be cached at the edge. `/media/*` is fine to cache: those files are immutable. |

The free plan's 100 MB request limit is above the app's own 60 MB video limit, so uploads fit.

### 2b. A flood guard at Cloudflare (recommended, 2 minutes)

The app has its own per-account rate limits (docs/v2/DECISIONS.md D20). This rule stops a flood from one IP before it even reaches the Mac. The free plan allows one rule, counted per IP over 10 seconds.

Dashboard → ayandev.app → **Security → Security rules → Create rule → Rate limiting rule**:
- **Name:** `glimpse api flood`
- **If incoming requests match:** Field *URI Path*, operator *starts with*, value `/api/`. Expression: `(starts_with(http.request.uri.path, "/api/"))`
- **With the same characteristics:** IP
- **When rate exceeds:** **200** requests per **10 seconds**
- **Then:** Block, for 10 seconds

Keep it this loose. Many people in Pakistan share one public IP (mobile networks and ISPs use carrier-grade NAT), so a tight per-IP limit would block real people. The fine-grained limits are in the app, per account.

### 2c. Turnstile: the "are you human" check on sign-up and login (recommended)

1. Dashboard → **Turnstile → Add widget**: name `glimpse`, hostname `glimpse.ayandev.app`, widget mode **Managed**. Leave pre-clearance off.
2. Copy the **site key** and **secret key** into `~/glimpse/.env` (next step) as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Push or re-run the deploy to pick them up.

Sign-up then always needs a passed check. Login needs one only after 3 failed attempts from an IP or for an account. Most people never see it: Cloudflare only shows a checkbox when it's unsure. Leave both keys empty to turn it off.

## 3. Secrets: `~/glimpse/.env` (once)

```bash
mkdir -p ~/glimpse && cd ~/glimpse
curl -fsSL https://raw.githubusercontent.com/Ayan-Shahid/Social-Media-App/main/.env.example -o .env
chmod 600 .env
open -e .env
```

Set these (generate each secret with `openssl rand -hex 24`; letters and numbers only):

```bash
POSTGRES_PASSWORD=<random>
APP_DB_PASSWORD=<random>
WORKER_DB_PASSWORD=<random>
S3_SECRET_KEY=<random>
APP_ORIGIN=https://glimpse.ayandev.app     # exactly this: no trailing slash
HOST_PORT=8090                              # change if Veritas already uses 8090
ADMIN_USERNAMES=<your username>             # Ops page + queue dashboard
CLOUDFLARE_TUNNEL_TOKEN=<token from step 2> # Option A only
TURNSTILE_SITE_KEY=<from step 2c>           # optional
TURNSTILE_SECRET_KEY=<from step 2c>
GOOGLE_CLIENT_ID=...                        # optional, see below
GOOGLE_CLIENT_SECRET=...
```

`deploy.sh` refuses to run if any secret is empty or still `change-me…`, or if `APP_ORIGIN` isn't `https://glimpse.ayandev.app`. Cookies, CSRF and the websocket origin check all depend on that exact value.

**Sign in with Google (optional).** Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application):
- Authorised JavaScript origin: `https://glimpse.ayandev.app`
- Authorised redirect URI: `https://glimpse.ayandev.app/api/auth/google/callback`

## 4. GitHub (once)

1. **Make `main` the deploy branch.** Merge `rebuild-2026` into `main` (a pull request is fine). CI also runs on pushes to `rebuild-2026`, but only `main` deploys.
2. **Settings → Environments → New environment → `production`:**
   - **Deployment branches and tags**: *Selected branches* → `main`.
   - Optional: **Required reviewers** → you. Then every deploy waits for one click of approval in the Actions tab. Useful while you're getting used to it.
3. **Settings → Actions → General → Fork pull request workflows**: "Require approval for all outside collaborators". Fork PRs can't reach the Mac anyway (the deploy job ignores them), but this also stops strangers using your Actions minutes.
4. **Images:** nothing to do. The workflow publishes `ghcr.io/ayan-shahid/glimpse-api` and `glimpse-web` with its own token, and the deploy job pulls them with that run's token. If you later want the images public, change it in the package settings on GitHub.

## 5. Install the runner on the Mac (once)

GitHub → the repository → **Settings → Actions → Runners → New self-hosted runner → macOS, x64**. It shows commands with a fresh token. Run them in Terminal, with one change: when `./config.sh` asks for **additional labels**, type **`glimpse`**.

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# curl -o actions-runner-osx-x64-<version>.tar.gz -L <url GitHub shows> && tar xzf ./actions-runner-osx-x64-*.tar.gz
./config.sh --url https://github.com/Ayan-Shahid/Social-Media-App --token <token GitHub shows> \
  --name macbook-2018 --labels glimpse --work _work --unattended
```

Let it see Docker (the runner doesn't load your shell profile), then run it as a background service that starts at login:

```bash
echo 'PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' >> .env
./svc.sh install
./svc.sh start
./svc.sh status        # "Started"
```

The runner should now show as **Idle** under Settings → Actions → Runners, with labels `self-hosted`, `macOS`, `X64`, `glimpse`.

## 6. First deploy

Push to `main` (or Actions → *CI and deploy* → **Run workflow** on `main`). You'll see:

1. **API tests**, **Web typecheck and build**, **Compose and Caddy config**: on GitHub's machines, about 5–8 min.
2. **Build images**: pushes both images tagged with the commit SHA.
3. **Deploy to the MacBook**: (approve it if you set a reviewer). Then on the Mac:
   - Pulls the images. The first time also pulls Postgres, Redis, SeaweedFS and Caddy: a few minutes.
   - Starts everything. `migrate` creates the database schema.
   - Checks that both API instances answer through Caddy, plus `/welcome` and the live service.
   - Checks `https://glimpse.ayandev.app/api/health` through Cloudflare (a warning only if that fails).

Then open **https://glimpse.ayandev.app**, create your account, and the Ops page (`/ops`) appears for the username in `ADMIN_USERNAMES`.

## Day to day

| Task | How |
|---|---|
| Ship a change | Push to `main` (or merge a PR). Tests → images → deploy, automatically. |
| See what's running | `cat ~/glimpse/current` (the commit SHA); history in `~/glimpse/releases.log` |
| Logs | `docker compose -p glimpse logs -f api-1 api-2 worker live` |
| Roll back by hand | In any checkout on the Mac: `GLIMPSE_TAG=<older sha> ./deploy/deploy.sh`. Or in Actions, open that older run and **Re-run** its deploy job. |
| Restart everything | `docker compose -p glimpse --project-directory ~/glimpse/app -f ~/glimpse/app/docker-compose.yml --env-file ~/glimpse/.env restart` |
| Stop Glimpse (keep data) | same command with `stop` instead of `restart` |

Data lives in Docker volumes named `glimpse_db-data`, `glimpse_storage-data` and `glimpse_queue-data`. They survive deploys, restarts and `docker compose down`. Only `down -v` deletes them.

## Rules that keep automatic rollback safe

A rollback starts the *previous* build against the *current* database. That only works if migrations are **additive**: add tables, columns or indexes; don't rename or drop in the same release that stops using them. To remove something, ship the code that stops using it first, and drop the column in a later release. Every migration so far follows this.

## When something goes wrong

| Symptom | Likely cause |
|---|---|
| Deploy job stays "Queued: waiting for a runner" | Mac asleep or logged out, or the runner service stopped: `cd ~/actions-runner && ./svc.sh status` |
| "Docker isn't running" | Open Docker Desktop; check "Start when you sign in" |
| Deploy red with "Rolling back…" | The new build failed health checks; the old one is running again. The job log shows the failing service's last lines. |
| Site shows Cloudflare error 1033/502 | The tunnel is down: `docker compose -p glimpse logs tunnel` (Option A) or check Veritas's tunnel (Option B) |
| Page loads blank, console shows CSP errors | Rocket Loader or Email Obfuscation is on (step 2) |
| Can log in locally but not on the domain | `APP_ORIGIN` isn't exactly `https://glimpse.ayandev.app` |
| Chat/live don't connect through the domain | Cloudflare WebSockets off, or a cache rule caching `/socket.io/` or `/stream/` |
| Sign-up says "Please confirm you're human" every time | Turnstile keys swapped, or the widget's hostname isn't `glimpse.ayandev.app` |
| Many people get "too many requests" at once | The Cloudflare rule in 2b is too tight for a shared IP: raise it |
