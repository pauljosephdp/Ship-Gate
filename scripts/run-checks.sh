#!/usr/bin/env bash
# Runs a site's own checks by npm script name, all of them, then fails if any failed.
# The names were validated by prepare.mjs: they exist and none touches production.
#
#   run-checks.sh NAME...           run each script
#   run-checks.sh --serve NAME...   serve the build first (as Cloudflare would) and pass
#                                   its address in SHIP_GATE_BASE_URL and BASE_URL
set -uo pipefail
serve=""
if [ "${1:-}" = "--serve" ]; then serve=1; shift; fi
if [ -n "$serve" ]; then
  : "${SHIP_GATE_SERVE:?prepare.mjs must run first}"
  bash -c "$SHIP_GATE_SERVE" > "${RUNNER_TEMP:-/tmp}/ship-gate-serve.log" 2>&1 &
  server_pid=$!
  trap 'kill "$server_pid" 2>/dev/null' EXIT
  export SHIP_GATE_BASE_URL="http://localhost:4321" BASE_URL="http://localhost:4321"
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$SHIP_GATE_BASE_URL/" 2>/dev/null && break; sleep 0.5; done
  curl -sS -o /dev/null "$SHIP_GATE_BASE_URL/" || { echo "::error::The site did not start:"; cat "${RUNNER_TEMP:-/tmp}/ship-gate-serve.log"; exit 1; }
  echo "Serving the build at $SHIP_GATE_BASE_URL"
fi
failed=()
for name in "$@"; do
  echo "::group::npm run $name"
  npm run "$name" || failed+=("$name")
  echo "::endgroup::"
done
if [ ${#failed[@]} -gt 0 ]; then
  for n in "${failed[@]}"; do echo "::error::Site check failed: npm run $n"; done
  exit 1
fi
echo "All $# site check(s) passed."
