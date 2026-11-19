#!/bin/sh
# Deploys the reader to a server over SSH + rsync.
# Settings come from deploy.env (copy deploy.env.example); HOST and BASE can also be set in the environment.
# Usage: ./deploy.sh          -> copies the app into $BASE/www/
#        ./deploy.sh server   -> also copies docker-compose.yml, .env and the nginx config, then (re)creates the container
set -e
cd "$(dirname "$0")"

_HOST="$HOST" _BASE="$BASE"
[ -f deploy.env ] && . ./deploy.env
HOST="${_HOST:-$HOST}" BASE="${_BASE:-$BASE}"
[ -n "$HOST" ] && [ -n "$BASE" ] || { echo "Set HOST and BASE in deploy.env (see deploy.env.example)" >&2; exit 1; }

# Only the files the app uses (add any new asset here)
FILES="index.html app.webmanifest app-192.png app-512.png"
RS="rsync -avz --checksum --chmod=F644,D755 --mkpath"

grep -o '<small id="ver">v[0-9]*' index.html | sed 's/.*>/Version: /'

if [ "$1" = server ]; then
  [ -f server/.env ] || { echo "Missing server/.env (see server/.env.example)" >&2; exit 1; }
  $RS server/docker-compose.yml server/.env "$HOST:$BASE/"
  $RS server/nginx/ "$HOST:$BASE/nginx/"
fi

$RS $FILES "$HOST:$BASE/www/"

if [ "$1" = server ]; then
  ssh "$HOST" "cd '$BASE' && docker compose up -d --force-recreate"
fi
