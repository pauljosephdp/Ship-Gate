#!/usr/bin/env bash
# Post-build proof: no PostHog code or key reached anything the browser downloads.
# Server output (server/, _worker.js) is excluded — posthog-node belongs there.
# Runs from the site directory; the build folder comes from distDir (default dist).
# A dated guardExemptions entry for posthog-client turns code findings into warnings;
# a key in client output always fails.
set -uo pipefail
DIST="${SHIP_GATE_DIST:-dist}"
DIST="${DIST%/}"
[ -d "$DIST" ] || { echo "::error::$DIST/ not found — run the build first."; exit 1; }
DIST_RE="$(printf '%s' "$DIST" | sed 's/[][\.*^$+?(){}|/]/\\&/g')"
client_hits() {
  grep -rlIE "$1" "$DIST" --include='*.js' --include='*.mjs' --include='*.html' 2>/dev/null \
    | grep -vE "^$DIST_RE/(server|_worker\.js)(/|$)" || true
}
keys=$(client_hits 'ph[cx]_[A-Za-z0-9]{20,}')
if [ -n "$keys" ]; then
  echo "::error::PostHog key found in client output — keys live only in Worker secrets:"; echo "$keys"; exit 1
fi
code=$(client_hits 'posthog-js|posthog\.init|i\.posthog\.com')
if [ -n "$code" ]; then
  if [[ " ${SHIP_GATE_EXEMPT:-} " == *" posthog-client "* ]]; then
    echo "::warning::[exempt: posthog-client] PostHog code in client output:"; echo "$code"; exit 0
  fi
  echo "::error::PostHog found in client output:"; echo "$code"; exit 1
fi
echo "Client bundle is PostHog-free."
