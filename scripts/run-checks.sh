#!/usr/bin/env bash
# Runs a site's own checks by npm script name, all of them, then fails if any failed.
# The names were validated by prepare.mjs: they exist and none touches production.
set -uo pipefail
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
