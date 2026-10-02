#!/usr/bin/env bash
# skip-fast: true leaves astro check, lint, unit tests and the post-build scans to the Workers Builds fast stage.
# That is only sound when Workers Builds actually built this commit. Look for its "Workers Builds" check run
# (it appears within seconds of a push) and skip only when it is there. When the commit has none, preview builds
# are off or the Cloudflare app is not connected, so the fast stage ran nowhere: run it here instead and say so.
# When the check runs cannot be read (the workflow lacks `checks: read`), keep skipping and warn: the ruleset's
# required "Workers Builds" check is then the only guard.
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_OUTPUT, SHIP_GATE_HEAD_SHA; SHIP_GATE_FAST_WAIT (seconds, default 90).
set -uo pipefail
sha="${SHIP_GATE_HEAD_SHA:?}"
wait="${SHIP_GATE_FAST_WAIT:-90}"
end=$((SECONDS + wait))
while :; do
  if ! runs="$(gh api "repos/$GITHUB_REPOSITORY/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[].name | select(startswith("Workers Builds"))] | length' 2>/dev/null)"; then
    echo "::warning::Ship Gate cannot read this commit's check runs (give the workflow checks: read). skip-fast trusts the ruleset's required \"Workers Builds\" check."
    echo "skip=true" >> "$GITHUB_OUTPUT"; exit 0
  fi
  if [ "${runs:-0}" -gt 0 ]; then
    echo "Workers Builds built $sha: the fast stage ran there, so verify skips it."
    echo "skip=true" >> "$GITHUB_OUTPUT"; exit 0
  fi
  if [ "$SECONDS" -ge "$end" ]; then
    echo "::warning::No \"Workers Builds\" check on $sha after ${wait}s: preview builds look off (Workers Builds → Settings → Build → Branch control), so the fast stage runs here."
    echo "skip=false" >> "$GITHUB_OUTPUT"; exit 0
  fi
  sleep 15
done
