#!/bin/sh
# Deploys the reader to a Docker host over SSH: copies the sources, then rebuilds and restarts the container.
# Settings come from deploy.env (copy deploy.env.example); HOST and BASE can also be set in the environment.
# Usage: ./deploy.sh
set -e
cd "$(dirname "$0")"

_HOST="$HOST" _BASE="$BASE"
[ -f deploy.env ] && . ./deploy.env
HOST="${_HOST:-$HOST}" BASE="${_BASE:-$BASE}"
[ -n "$HOST" ] && [ -n "$BASE" ] || { echo "Set HOST and BASE in deploy.env (see deploy.env.example)" >&2; exit 1; }
[ -f .env ] || { echo "Missing .env (see .env.example)" >&2; exit 1; }

# Build context and compose files (keep in sync with the Dockerfile and .dockerignore)
FILES="Dockerfile .dockerignore docker-compose.yml .env server/server.js index.html sw.js app.webmanifest app-192.png app-512.png"

grep -o '<small id="ver">v[0-9]*' index.html | sed 's/.*>/Version: /'

rsync -avzR --checksum --chmod=F644,D755 --mkpath $FILES "$HOST:$BASE/"
ssh "$HOST" "cd '$BASE' && docker compose up -d --build --remove-orphans && docker image prune -f >/dev/null"
