#!/usr/bin/env bash
# Ship Gate's fast stage inside Cloudflare Workers Builds. Call it at the end of the
# build command's script (package.json "build", or "ci:build"):
#   "build": "astro build && bash scripts/ship-gate-workers.sh"
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
  # The Ship-Gate repo is private: a build secret (Settings → Build → Variables and
  # secrets) holds a fine-grained token with read-only Contents on pauljosephdp/Ship-Gate.
  if [ -z "${SHIP_GATE_READ_TOKEN:-}" ]; then
    echo "Ship Gate: SHIP_GATE_READ_TOKEN build secret not set; fast stage skipped."; exit 0
  fi
  tag="$(grep -m1 -oE 'pauljosephdp/Ship-Gate@v[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml | cut -d@ -f2)"
  dir="$(mktemp -d)"
  git clone -q --depth 1 --branch "$tag" "https://x-access-token:${SHIP_GATE_READ_TOKEN}@github.com/pauljosephdp/Ship-Gate.git" "$dir"
fi
bash "$dir/scripts/gate-fast.sh" ship-gate.config.json
