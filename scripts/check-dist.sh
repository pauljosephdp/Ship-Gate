#!/usr/bin/env bash
# Post-build proof: no PostHog code or key reached anything the browser downloads.
# Server output (server/, _worker.js) is excluded — posthog-node belongs there.
# Runs from the site directory; the build folder comes from distDir (default dist).
set -uo pipefail
DIST="${SHIP_GATE_DIST:-dist}"
[ -d "$DIST" ] || { echo "::error::$DIST/ not found — run the build first."; exit 1; }
PATTERN='posthog-js|posthog\.init|i\.posthog\.com|ph[cx]_[A-Za-z0-9]{20,}'
hits=$(grep -rlIE "$PATTERN" "$DIST" --include='*.js' --include='*.mjs' --include='*.html' 2>/dev/null \
  | grep -vE "^$DIST/(server|_worker\.js)(/|$)" || true)
if [ -n "$hits" ]; then
  echo "::error::PostHog found in client output:"; echo "$hits"; exit 1
fi
echo "Client bundle is PostHog-free."
