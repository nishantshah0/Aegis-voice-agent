#!/usr/bin/env bash
# Checks that Entire is fully set up on this machine for this repo.
#   scripts/entire-check.sh
# Prints a tick or a cross for each piece, and what to run to fix a cross.
export PATH="$HOME/.local/bin:$PATH"
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n      fix: %s\n' "$1" "$2"; fail=1; }

echo "Entire check for $(basename "$PWD")"

if command -v entire >/dev/null; then ok "Entire CLI installed ($(entire version 2>/dev/null | head -1))"
else bad "Entire CLI not found" "curl -fsSL https://entire.com/install.sh | bash, then add ~/.local/bin to your PATH"; echo; exit 1; fi

if entire auth status 2>/dev/null | grep -q "Logged in"; then ok "Signed in to Entire"
else bad "Not signed in" "entire login"; fi

st="$(entire status 2>/dev/null)"
if echo "$st" | grep -q "Enabled"; then ok "Capture enabled in this repo"
else bad "Capture not enabled" "entire enable --agent <your tool>   (claude-code, cursor, codex, ...)"; fi

agents="$(echo "$st" | sed -n 's/.*Agents · //p' | head -1)"
if [ -n "$agents" ]; then ok "Agent hooks installed: $agents"
else bad "No agent hooks for your AI tool" "entire enable --agent <your tool>"; fi

if [ -x .git/hooks/prepare-commit-msg ] && grep -q entire .git/hooks/prepare-commit-msg 2>/dev/null; then ok "Git hooks installed (commits get linked to sessions)"
else bad "Git hooks missing on this clone" "entire enable --agent <your tool>"; fi

if echo "$st" | grep -q "namereserve-sessions"; then ok "Transcripts go to the private sessions repo"
else bad "Transcripts aren't routed to the private repo" "git pull (the setting is in .entire/settings.json)"; fi

if entire graph version >/dev/null 2>&1; then ok "Graph plugin installed"
else bad "Graph plugin missing" "entire plugin install graph"; fi

bs="$(entire brain status 2>/dev/null)"
if [ -n "$bs" ]; then
  mem="$(echo "$bs" | sed -n 's/.*Memories *| *//p' | head -1)"
  ok "Brain plugin installed (memories: ${mem:-unknown})"
  if echo "$bs" | grep -q "Brainstore | connected"; then ok "Brain shared with the team"
  else bad "Brain not shared yet" "entire brain connect"; fi
else bad "Brain plugin missing" "entire plugin install brain && entire brain setup --no-backfill --no-daemon"; fi

n="$(entire checkpoint list 2>/dev/null | sed -n 's/.*checkpoints *//p' | head -1)"
if [ "${n:-0}" -gt 0 ] 2>/dev/null; then ok "Checkpoints on this branch: $n"
else printf '  \033[33m•\033[0m No checkpoints on this branch yet (normal until you commit from a new AI session)\n'; fi

trails="$(entire trail list --project gh/nishantshah0 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
if [ "${trails:-0}" -gt 0 ]; then ok "Can list the team's Trails: $trails"
elif entire trail show 2 --project gh/nishantshah0 >/dev/null 2>&1; then
  ok "Can open and create Trails (the full list is owner-only on a personal repo: use scripts/channel.sh trails)"
else bad "Can't open the team's Trails" "accept your GitHub invite to nishantshah0/namereserve, then entire logout && entire login (choose GitHub)"; fi

echo
if [ "$fail" -eq 0 ]; then echo "All set. Start a NEW AI session so its hooks load, then start your role's loop (docs/AUTONOMY.md)."
else echo "Fix the crosses above, then run this again."; fi
exit $fail
