#!/usr/bin/env bash
# Post-build proof: no PostHog code or key reached anything the browser downloads.
# Server output (dist/server, dist/_worker.js) is excluded — posthog-node belongs there.
set -uo pipefail
[ -d dist ] || { echo "::error::dist/ not found — run the build first."; exit 1; }
PATTERN='posthog-js|posthog\.init|i\.posthog\.com|ph[cx]_[A-Za-z0-9]{20,}'
hits=$(grep -rlIE "$PATTERN" dist --include='*.js' --include='*.mjs' --include='*.html' 2>/dev/null \
  | grep -vE '^dist/(server|_worker\.js)(/|$)' || true)
if [ -n "$hits" ]; then
  echo "::error::PostHog found in client output:"; echo "$hits"; exit 1
fi
echo "Client bundle is PostHog-free."
