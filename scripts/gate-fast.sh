#!/usr/bin/env bash
# Ship Gate's fast stage outside GitHub Actions: every check that needs no browser.
# Cloudflare Workers Builds runs it on every non-production build (see
# templates/caller/scripts/ship-gate-workers.sh), after the site's own build, so
# each push gets guards, astro check, tests, the site's checks and the post-build
# scans without spending an Actions minute. The browser suite and Lighthouse stay
# in the verify action, which runs once the pull request is ready for review.
#
#   gate-fast.sh [CONFIG]   run from the site directory, after `npm run build`
#   SHIP_GATE_SKIP_CHECKS="name …"   site checks to leave to verify (need git history)
#
# It runs the same commands as action.yml's steps of the same names and prints the
# same summary table; self-test.sh fails if the two lists drift apart.
set -uo pipefail
CONFIG="${1:-ship-gate.config.json}"
GATE="$(cd "$(dirname "$0")/.." && pwd -P)"
export RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
# prepare.mjs exports NAME=value lines to $GITHUB_ENV. Always a private file: inside
# GitHub Actions the real one belongs to the job, and truncating it would lose its env.
GITHUB_ENV="$(mktemp "$RUNNER_TEMP/ship-gate.env.XXXXXX")"
export GITHUB_ENV

declare -A outcome
# run ID COMMAND... — record success or failure; never stop the sequence.
run() {
  local id=$1; shift
  echo "::group::$id"
  if "$@"; then outcome[$id]=success; else outcome[$id]=failure; fi
  echo "::endgroup::"
}
# Load what prepare.mjs exported (NAME=value lines).
load_env() {
  local line
  while IFS= read -r line; do [ -n "$line" ] && export "${line?}"; done < "$GITHUB_ENV"
}
policy() { [[ " ${SHIP_GATE_POLICIES:-} " == *" $1 "* ]]; }

run prepare node "$GATE/scripts/prepare.mjs" verify "$CONFIG"; load_env
# SHIP_GATE_SKIP_CHECKS: site checks this build cannot answer (e.g. one that needs git
# history, which Workers Builds does not clone). They still run in verify.
skipped=""
if [ -n "${SHIP_GATE_SKIP_CHECKS:-}" ]; then
  for phase in PREBUILD POSTBUILD; do
    var="SHIP_GATE_CHECKS_$phase" kept=""
    for c in ${!var:-}; do
      if [[ " $SHIP_GATE_SKIP_CHECKS " == *" $c "* ]]; then skipped+=" $c"; else kept+=" $c"; fi
    done
    export "$var=${kept# }"
  done
  [ -n "$skipped" ] && echo "Site checks left to verify:$skipped"
fi
run guards bash "$GATE/scripts/guards.sh"
run check npm run check
[ -n "${SHIP_GATE_HAS_LINT:-}" ] && run lint npm run lint
[ -n "${SHIP_GATE_HAS_TEST:-}" ] && run test npm test
# shellcheck disable=SC2086 # check lists are space-separated names
[ -n "${SHIP_GATE_CHECKS_PREBUILD:-}" ] && run prebuild bash "$GATE/scripts/run-checks.sh" $SHIP_GATE_CHECKS_PREBUILD
if [ "${outcome[prepare]}" = success ]; then
  run afterbuild node "$GATE/scripts/prepare.mjs" after-build "$CONFIG"; load_env
fi
policy posthog-server-only && run dist bash "$GATE/scripts/check-dist.sh"
if [ "${outcome[afterbuild]:-}" = success ]; then
  policy posthog-hybrid && run posthog node "$GATE/scripts/check-posthog.mjs"
  run structure node "$GATE/scripts/check-structure.mjs"
  run discovery node "$GATE/scripts/check-discovery.mjs"
  run copy node "$GATE/scripts/check-copy.mjs"
  { policy market-cn || policy rtl-logical-css; } && run market node "$GATE/scripts/check-market.mjs"
fi
# shellcheck disable=SC2086
[ -n "${SHIP_GATE_CHECKS_POSTBUILD:-}" ] && run postbuild bash "$GATE/scripts/run-checks.sh" $SHIP_GATE_CHECKS_POSTBUILD

failed=0
table="| Check | Result |"$'\n'"|---|---|"
for row in \
  "prepare=Contract and config" "guards=Stack guards" "check=astro check" "lint=Lint" "test=Unit tests" \
  "prebuild=Site checks before build" "afterbuild=Page resolution" "dist=Client bundle PostHog-free" \
  "posthog=PostHog on every page" "structure=Structure scan" "discovery=Discovery (SEO, AEO, GEO, AIO)" \
  "copy=Placeholder copy" "market=Market scan" "postbuild=Site checks after build"; do
  id=${row%%=*} name=${row#*=}
  case "${outcome[$id]:-}" in
    success) mark="✅ passed" ;;
    failure) mark="❌ failed"; failed=1 ;;
    *) mark="➖ not run" ;;
  esac
  table+=$'\n'"| $name | $mark |"
done
[ -n "$skipped" ] && table+=$'\n'"| Site checks left to verify:$skipped | ➖ not run here |"
table+=$'\n'"| Browser tests and Lighthouse | ➖ run by verify once the PR is ready |"
printf '\nShip Gate (fast stage)\n\n%s\n\n' "$table"
if [ "$failed" -ne 0 ]; then echo "Ship Gate fast stage failed — see the table above and each group's log."; exit 1; fi
echo "Ship Gate fast stage passed."
