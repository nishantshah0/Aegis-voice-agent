#!/usr/bin/env bash
# Copy the app to the Vultr server, build it there and restart it (task 2.6).
# Run from the repository root on your laptop:
#   HOST=root@203.0.113.7 DOMAIN=refill.example.com bash hosting/deploy.sh          # code only
#   HOST=root@203.0.113.7 DOMAIN=refill.example.com bash hosting/deploy.sh --env    # also copy .env
# .env (keys) is copied only with --env, straight to the server over SSH, readable only by the
# app user. It never goes into git.
set -euo pipefail

: "${HOST:?Set HOST, e.g. HOST=root@203.0.113.7}"
: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=refill.example.com}"
APP_DIR=/opt/refill-guard/app
[ -f package.json ] && [ -d app ] || { echo "Run from the repository root." >&2; exit 1; }

echo "== Copying the code"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude .claude --exclude .entire \
  --exclude planning --exclude 'results/hijack' --exclude '.env' --exclude '.env.*' --exclude .agent-role \
  ./ "$HOST:$APP_DIR/"

if [ "${1:-}" = "--env" ]; then
  echo "== Copying .env (keys)"
  scp -q .env "$HOST:$APP_DIR/.env"
  ssh "$HOST" "chmod 600 $APP_DIR/.env"
  echo "   Reminder: on the server, .env needs APP_BASE_URL=https://$DOMAIN and no DEMO_CONTROLS=on."
fi

echo "== Building on the server"
ssh "$HOST" "chown -R refill:refill /opt/refill-guard && sudo -u refill bash -c 'cd $APP_DIR && npm ci --no-audit --no-fund && npm run build' && systemctl restart refill-guard"

echo "== Checking https://$DOMAIN"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/clock" || true)
  [ "$code" = 200 ] && break
  sleep 2
done
echo "GET https://$DOMAIN/api/clock -> ${code:-no answer}"
[ "${code:-}" = 200 ] || { echo "Not up yet: on the server, check 'journalctl -u refill-guard -n 50' and 'journalctl -u caddy -n 50'." >&2; exit 1; }
