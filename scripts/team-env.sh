#!/usr/bin/env bash
# Unlock the team's shared settings into .env.
#   scripts/team-env.sh            (asks for the passphrase Nishant tells you in person)
# Works in macOS/Linux terminals and Git Bash on Windows (needs openssl, which both include).
# config/team.env.enc holds only shared values: Auth0 sign-in, the demo database, voice and
# Gemini keys, and the test pharmacist login. Never commit the decrypted .env.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

enc=config/team.env.enc
[ -f "$enc" ] || { echo "missing $enc: run git pull first" >&2; exit 1; }

if [ -n "${AEGIS_TEAM_PASSPHRASE:-}" ]; then
  pass=$AEGIS_TEAM_PASSPHRASE
else
  printf 'Team passphrase: ' >&2
  read -rs pass
  echo >&2
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
if ! printf '%s' "$pass" | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$enc" -out "$tmp" -pass stdin 2>/dev/null; then
  echo "Wrong passphrase (or the file is damaged). Ask Nishant again." >&2
  exit 1
fi
# Each person gets their own session secret.
echo "AUTH0_SECRET=$(openssl rand -hex 32)" >> "$tmp"

if [ -f .env ]; then
  # Keep the person's own extra lines, replace the shared ones, drop the dev stand-in.
  keys=$(grep -oE '^[A-Z0-9_]+=' "$tmp" | sed 's/=$//')
  keep=$(mktemp)
  grep -vE "^($(echo "$keys" | paste -sd'|' -))=" .env | grep -v '^LOCAL_DEV_APPROVER=' > "$keep" || true
  cat "$keep" "$tmp" > .env
  rm -f "$keep"
  echo "Updated .env (kept your own extra lines, removed LOCAL_DEV_APPROVER)."
else
  cp "$tmp" .env
  echo "Wrote .env."
fi
chmod 600 .env 2>/dev/null || true
echo "Next: restart npm run dev, open http://localhost:3000 and sign in with TEST_PHARMACIST_EMAIL / TEST_PHARMACIST_PASSWORD from .env."
