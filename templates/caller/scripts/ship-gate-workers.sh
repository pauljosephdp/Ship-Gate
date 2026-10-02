#!/usr/bin/env bash
# Ship Gate's fast stage inside Cloudflare Workers Builds. Call it at the end of the
# build command's script (package.json "build", or "ci:build"):
#   "build": "astro build && bash scripts/ship-gate-workers.sh"
# A site check that needs git history (Workers Builds clones without it) can be left
# to verify:  ... && SHIP_GATE_SKIP_CHECKS="lastmod:check" bash scripts/ship-gate-workers.sh
# It does nothing outside Workers Builds (locally, and in GitHub Actions' verify,
# which runs the build too) and on the production branch (main was verified on its
# PR). On every other branch it runs guards, astro check, tests, the site's checks
# and the post-build scans against the build that just finished, so a push gets
# them without spending an Actions minute. A failure fails the build, which turns
# the "Workers Builds: <worker>" check red on the pull request.
set -euo pipefail
[ -n "${WORKERS_CI:-}" ] || exit 0
if [ "${WORKERS_CI_BRANCH:-}" = main ]; then echo "Ship Gate: production build; the fast stage ran on the PR."; exit 0; fi
# SHIP_GATE_HOME: a local Ship-Gate checkout, for testing this script.
dir="${SHIP_GATE_HOME:-}"
if [ -z "$dir" ]; then
  # Ship-Gate is public (v3.10.0), so the clone needs no token. A SHIP_GATE_READ_TOKEN
  # build secret left over from a private Ship-Gate is still used when it is set.
  tag="$(grep -m1 -oE 'pauljosephdp/Ship-Gate@v[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml 2>/dev/null | cut -d@ -f2 || true)"
  url="https://github.com/pauljosephdp/Ship-Gate.git"
  [ -z "${SHIP_GATE_READ_TOKEN:-}" ] || url="https://x-access-token:${SHIP_GATE_READ_TOKEN}@github.com/pauljosephdp/Ship-Gate.git"
  dir="$(mktemp -d)"
  if [ -z "$tag" ] || ! git clone -q --depth 1 --branch "$tag" "$url" "$dir" 2>/dev/null; then
    # SHIP_GATE_REQUIRE_FAST=1 (a Workers Builds build variable): a site whose verify runs
    # with skip-fast relies on this stage, so a build that cannot run it must not go green.
    if [ "${SHIP_GATE_REQUIRE_FAST:-}" = 1 ]; then
      echo "::error::Ship Gate ${tag:-<no pin in .github/workflows/ci.yml>} could not be fetched and SHIP_GATE_REQUIRE_FAST=1: the fast stage must run."; exit 1
    fi
    echo "Ship Gate: ${tag:-<no pin>} could not be fetched; fast stage skipped."; exit 0
  fi
fi
bash "$dir/scripts/gate-fast.sh" ship-gate.config.json
