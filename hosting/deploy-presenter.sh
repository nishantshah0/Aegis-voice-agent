#!/usr/bin/env bash
# Use the linked, isolated Vercel presenter project; keep the general store out of the demo runtime.
set -euo pipefail
exec vercel deploy --prod --env 'DATABASE_URL=' --env 'PATIENT_SIMULATION=community-demo' "$@"
