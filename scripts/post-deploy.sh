#!/usr/bin/env bash
# Ship Gate's post-deploy check: what production actually serves after a deploy.
# One implementation for both callers:
#   - the post-deploy action (post-deploy/action.yml), on GitHub Actions;
#   - a Cloudflare Workers Builds deploy command, right after `wrangler deploy`
#     (templates/caller/scripts/ship-gate-after-deploy.sh), which needs no runner.
#
#   post-deploy.sh [CONFIG]   run from the site directory
# Env: SHA (commit production must serve; defaults to GITHUB_SHA, then
# WORKERS_CI_COMMIT_SHA), WAIT_MINUTES (default 10), CRUX_API_KEY (optional).
# Every check runs even after one fails; the exit code says whether any failed.
set -uo pipefail
CONFIG="${1:-ship-gate.config.json}"
GATE="$(cd "$(dirname "$0")/.." && pwd -P)"
SHA="${SHA:-${GITHUB_SHA:-${WORKERS_CI_COMMIT_SHA:-}}}"
WAIT_MINUTES="${WAIT_MINUTES:-10}"
export RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
# prepare.mjs exports NAME=value lines to $GITHUB_ENV. Always a private file: inside
# GitHub Actions the real one belongs to the job, and truncating it would lose its env.
GITHUB_ENV="$(mktemp "$RUNNER_TEMP/ship-gate-post-deploy.env.XXXXXX")"
export GITHUB_ENV
node "$GATE/scripts/prepare.mjs" post-deploy "$CONFIG" || exit 1
while IFS= read -r line; do [ -n "$line" ] && export "${line?}"; done < "$GITHUB_ENV"
policy() { [[ " ${SHIP_GATE_POLICIES:-} " == *" $1 "* ]]; }
status=0
step() { echo "::group::$1"; }

step "Wait for production to serve this commit"
[ -n "$SHA" ] || { echo "::error::No commit to wait for: set SHA."; exit 1; }
served=0
for _ in $(seq 1 $(( WAIT_MINUTES * 3 ))); do
  # Fetch first, then search. Piping curl into `grep -q` breaks under pipefail:
  # grep exits on the first match, curl fails writing the rest (exit 23), and the
  # match reads as a miss.
  page=$(curl -fsS "$SHIP_GATE_SITE_URL/?cb=$(date +%s)") || page=""
  if grep -qF "name=\"build-sha\" content=\"$SHA\"" <<<"$page"; then served=1; break; fi
  sleep 20
done
echo "::endgroup::"
if [ "$served" -ne 1 ]; then
  echo "::error::Production not serving $SHA after $WAIT_MINUTES min. Check the deploy pipeline; roll back if needed."
  exit 1
fi
echo "Production is serving $SHA"

step "Smoke check key URLs"
for p in $SHIP_GATE_SMOKE_PATHS; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SHIP_GATE_SITE_URL$p")
  echo "$p -> $code"
  [ "$code" = "200" ] || { echo "::error::$p returned $code"; status=1; }
done
echo "::endgroup::"

step "Production serves crawlers and agents (robots.txt, sitemaps, Link, Markdown)"
node "$GATE/scripts/check-live.mjs" || status=1
echo "::endgroup::"

step "Production answers plain requests; freshness headers; field Core Web Vitals"
node "$GATE/scripts/check-headers-live.mjs" || status=1
echo "::endgroup::"

if policy posthog-server-only; then
  step "Production HTML is PostHog-free"
  # Fetch first, then search (see the wait step). An unreachable page fails too.
  if ! page=$(curl -fsS "$SHIP_GATE_SITE_URL/"); then
    echo "::error::Could not fetch production HTML to check it."; status=1
  elif grep -qE 'posthog-js|posthog\.init|i\.posthog\.com|ph[cx]_[A-Za-z0-9]{20,}' <<<"$page"; then
    echo "::error::PostHog client code or key found in production HTML."; status=1
  else
    echo "Production HTML is PostHog-free."
  fi
  echo "::endgroup::"
fi
if policy posthog-hybrid; then
  step "Production starts PostHog (posthog-hybrid)"
  node "$GATE/scripts/check-posthog-live.mjs" || status=1
  echo "::endgroup::"
fi
if policy analytics-always-on; then
  step "Production carries Zaraz (analytics-always-on)"
  node "$GATE/scripts/check-analytics-live.mjs" || status=1
  echo "::endgroup::"
fi

if [ "$status" -ne 0 ]; then echo "::error::Post-deploy check failed. Roll back, then fix forward."; exit 1; fi
echo "Post-deploy check passed."
