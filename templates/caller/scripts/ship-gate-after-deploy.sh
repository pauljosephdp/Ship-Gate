#!/usr/bin/env bash
# Ship Gate's post-deploy check inside Cloudflare Workers Builds, straight after the
# deploy, so no GitHub Actions runner waits on it. Append it to the Workers Builds
# deploy command (dashboard → Settings → Build), e.g.
#   npx wrangler deploy && bash scripts/ship-gate-after-deploy.sh
# A failure marks the production build red: the deploy has already happened, so
# roll back, then fix forward — the same signal post-deploy.yml gave.
set -euo pipefail
[ -n "${WORKERS_CI:-}" ] || { echo "Ship Gate: not in Workers Builds; nothing to do."; exit 0; }
# SHIP_GATE_HOME: a local Ship-Gate checkout, for testing this script.
dir="${SHIP_GATE_HOME:-}"
if [ -z "$dir" ]; then
  if [ -z "${SHIP_GATE_READ_TOKEN:-}" ]; then
    echo "::error::SHIP_GATE_READ_TOKEN build secret not set; the post-deploy check cannot run."; exit 1
  fi
  tag="$(grep -m1 -oE 'pauljosephdp/Ship-Gate@v[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml | cut -d@ -f2)"
  dir="$(mktemp -d)"
  git clone -q --depth 1 --branch "$tag" "https://x-access-token:${SHIP_GATE_READ_TOKEN}@github.com/pauljosephdp/Ship-Gate.git" "$dir"
fi
SHA="${WORKERS_CI_COMMIT_SHA:?}" WAIT_MINUTES="${SHIP_GATE_WAIT_MINUTES:-5}" \
  bash "$dir/scripts/post-deploy.sh" ship-gate.config.json
