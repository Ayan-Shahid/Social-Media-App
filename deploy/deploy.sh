#!/usr/bin/env bash
# Deploys one tested build to this machine (the MacBook). Run by the GitHub Actions self-hosted runner
# after CI passes; also safe to run by hand. See docs/DEPLOY.md.
#
#   GLIMPSE_TAG=<commit sha> GLIMPSE_API_IMAGE=ghcr.io/... GLIMPSE_WEB_IMAGE=ghcr.io/... deploy/deploy.sh
#
# What it does:
#   1. checks Docker is up and ~/glimpse/.env exists (secrets live only there, never in git or GitHub)
#   2. copies the Compose file and deploy/ into ~/glimpse/app, a stable place for bind mounts
#   3. pulls the images CI built for this commit (nothing is built on the Mac)
#   4. starts them: migrations run first (the "migrate" service), then the apps
#   5. health-checks through Caddy: both API instances, the web app, the live service
#   6. on failure, puts the previous release back and exits non-zero (the Actions run goes red)
#
# Written for macOS's bash 3.2: no associative arrays, no GNU-only tools (timeout, sha256sum).
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
GLIMPSE_HOME="${GLIMPSE_HOME:-$HOME/glimpse}"
APP="$GLIMPSE_HOME/app"
ENV_FILE="$GLIMPSE_HOME/.env"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
: "${GLIMPSE_TAG:?Set GLIMPSE_TAG (the commit sha CI built)}"
: "${GLIMPSE_API_IMAGE:=ghcr.io/ayan-shahid/glimpse-api}"
: "${GLIMPSE_WEB_IMAGE:=ghcr.io/ayan-shahid/glimpse-web}"
export GLIMPSE_TAG GLIMPSE_API_IMAGE GLIMPSE_WEB_IMAGE

log() { printf '\n\033[1m[deploy %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '\n\033[31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# ---------- 1. preflight ----------
docker info >/dev/null 2>&1 || fail "Docker isn't running. Open Docker Desktop (and set it to start at login)."
[ -f "$ENV_FILE" ] || fail "Missing $ENV_FILE. Create it once from .env.example (docs/DEPLOY.md, step 3)."
for key in POSTGRES_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD S3_SECRET_KEY APP_ORIGIN; do
  v="$(envval "$key" || true)"
  [ -n "$v" ] || fail "$key is empty in $ENV_FILE"
  case "$v" in change-me*) fail "$key in $ENV_FILE is still the example value";; esac
done
if [ -n "${GLIMPSE_PUBLIC_URL:-}" ] && [ "$(envval APP_ORIGIN)" != "$GLIMPSE_PUBLIC_URL" ]; then
  fail "APP_ORIGIN in $ENV_FILE is '$(envval APP_ORIGIN)' but this deploy is for $GLIMPSE_PUBLIC_URL. They must match exactly (cookies, CSRF, websockets)."
fi
HOST_PORT="$(envval HOST_PORT || true)"; HOST_PORT="${HOST_PORT:-8090}"
# The Cloudflare tunnel container runs only if this machine has its own token for it.
if [ -n "$(envval CLOUDFLARE_TUNNEL_TOKEN || true)" ]; then export COMPOSE_PROFILES=tunnel; fi

compose() { docker compose --project-name glimpse --project-directory "$APP" -f "$APP/docker-compose.yml" --env-file "$ENV_FILE" "$@"; }

# ---------- 2. config files to a stable place ----------
# Copy in place (cp, not rsync/mv): Docker bind-mounts single files by inode, so replacing the file
# would leave the running container reading the old one.
log "Syncing config to $APP"
mkdir -p "$APP/deploy/errors"
changed=""
for f in docker-compose.yml deploy/Caddyfile deploy/seaweedfs.sh deploy/errors/down.html; do
  if ! cmp -s "$SRC/$f" "$APP/$f" 2>/dev/null; then changed="$changed $f"; cp "$SRC/$f" "$APP/$f"; fi
done
chmod +x "$APP/deploy/seaweedfs.sh"
[ -n "$changed" ] && echo "changed:$changed"

PREV="$(cat "$GLIMPSE_HOME/current" 2>/dev/null || true)"
log "Deploying ${GLIMPSE_TAG:0:12} (previous: ${PREV:-none})"

# ---------- 3. pull ----------
log "Pulling images"
compose pull --quiet --ignore-buildable 2>/dev/null || compose pull --quiet

# ---------- 4. start ----------
start() {
  compose up -d --no-build --remove-orphans
  # Bind-mounted config changed but the container didn't: pick it up.
  case "$changed" in *Caddyfile*) compose restart proxy >/dev/null ;; esac
  case "$changed" in *seaweedfs.sh*) compose restart storage >/dev/null ;; esac
}

# ---------- 5. health ----------
healthy() {
  # migrations must have finished cleanly
  local code
  for _ in $(seq 1 60); do
    code="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' glimpse-migrate-1 2>/dev/null || echo "missing")"
    case "$code" in "exited 0") break ;; exited*) echo "migrate failed: $code"; return 1 ;; esac
    sleep 2
  done
  [ "$code" = "exited 0" ] || { echo "migrate didn't finish"; return 1; }
  # through Caddy, like a visitor: both API instances must answer, plus web and live
  local seen="" body
  for _ in $(seq 1 60); do
    body="$(curl -fsS --max-time 3 "http://127.0.0.1:$HOST_PORT/api/health" 2>/dev/null || true)"
    case "$body" in *api-1*) case "$seen" in *api-1*) ;; *) seen="$seen api-1";; esac ;; esac
    case "$body" in *api-2*) case "$seen" in *api-2*) ;; *) seen="$seen api-2";; esac ;; esac
    case "$seen" in *api-1*api-2*|*api-2*api-1*) break ;; esac
    sleep 2
  done
  case "$seen" in *api-1*api-2*|*api-2*api-1*) ;; *) echo "API instances answering:${seen:- none}"; return 1 ;; esac
  for path in /welcome /stream/health; do
    curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$HOST_PORT$path" || { echo "$path is not answering"; return 1; }
  done
  return 0
}

start
log "Health checks"
if healthy; then
  echo "$GLIMPSE_TAG" > "$GLIMPSE_HOME/current"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GLIMPSE_TAG" "ok" >> "$GLIMPSE_HOME/releases.log"
  log "Live: ${GLIMPSE_TAG:0:12}"
  if [ -n "${GLIMPSE_PUBLIC_URL:-}" ]; then
    # Through Cloudflare: a warning only (the tunnel or DNS can be down while the app is fine).
    curl -fsS --max-time 10 -o /dev/null "$GLIMPSE_PUBLIC_URL/api/health" && echo "reachable at $GLIMPSE_PUBLIC_URL" \
      || echo "::warning::$GLIMPSE_PUBLIC_URL/api/health didn't answer. The app is up locally; check the Cloudflare tunnel."
  fi
  # Keep a few days of old images for rollbacks; drop the rest.
  docker image prune -af --filter "until=168h" --filter "label=org.opencontainers.image.source" >/dev/null 2>&1 || true
  exit 0
fi

# ---------- 6. roll back ----------
log "Deploy failed. Recent logs:"
compose ps -a || true
for s in migrate api-1 api-2 web live proxy; do echo "--- $s"; compose logs --no-color --tail 40 "$s" 2>/dev/null || true; done
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GLIMPSE_TAG" "failed" >> "$GLIMPSE_HOME/releases.log"
if [ -n "$PREV" ] && [ "$PREV" != "$GLIMPSE_TAG" ]; then
  log "Rolling back to ${PREV:0:12}"
  # Migrations only ever add (DECISIONS.md D19), so the previous build runs on the newer schema.
  GLIMPSE_TAG="$PREV" start
  if GLIMPSE_TAG="$PREV" healthy; then echo "rolled back to ${PREV:0:12}; the site is up"; else echo "::error::rollback also failed; the site may be down"; fi
fi
fail "Deploy of ${GLIMPSE_TAG:0:12} failed"
