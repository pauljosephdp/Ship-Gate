#!/usr/bin/env bash
# Keeps README.md in step with Ship Gate. Runs in self-test.yml on every PR and push.
#   check-readme.sh [BASE]
# 1. Every version README.md and the caller templates tell sites to pin is the
#    newest CHANGELOG.md version.
# 2. With BASE (the PR's base commit): a change to what Ship Gate does (the action,
#    its scripts, browser tests, templates, tools or workflows) must update README.md.
#    Tests (scripts/self-test.sh, test/), CLAUDE.md, CHANGELOG.md and docs/ need not.
set -uo pipefail
cd "${REPO_ROOT:-$(git rev-parse --show-toplevel)}" || exit 1
fail=0

latest="$(grep -m1 -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md | cut -c4-)"
if [ -z "$latest" ]; then echo "::error::No \"## vX.Y.Z\" heading in CHANGELOG.md."; exit 1; fi
if [[ "$(grep -m1 -E '^## v' CHANGELOG.md)" != *"not released"* ]]; then
  while IFS= read -r hit; do
    v="$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' <<<"${hit#*:*:}" | head -1)"
    [ "$v" = "$latest" ] || { echo "::error::${hit%%:*} (line $(cut -d: -f2 <<<"$hit")) pins $v; the newest release is $latest. Update it."; fail=1; }
  done < <(grep -nE 'Ship-Gate(/post-deploy)?@v[0-9]|Ship Gate v[0-9]+\.[0-9]+\.[0-9]+ in this repo|adopt ship gate v[0-9]' \
    README.md templates/caller/.github/workflows/*.yml 2>/dev/null)
fi

if [ -n "${1:-}" ]; then
  changed="$(git diff --name-only "$1"...HEAD)" || { echo "::error::Cannot diff against $1."; exit 1; }
  shipped="$(grep -E '^(action\.yml|post-deploy/|scripts/|e2e/|templates/|tools/|playwright\.config\.ts|lighthouserc|\.github/workflows/)' <<<"$changed" \
    | grep -vE '^scripts/self-test\.sh$')"
  if [ -n "$shipped" ] && ! grep -qx 'README.md' <<<"$changed"; then
    echo "::error::This change alters what Ship Gate does but not README.md. Describe it there:"
    sed 's/^/  /' <<<"$shipped"
    fail=1
  fi
fi

[ "$fail" -eq 0 ] && echo "README.md is up to date."
exit "$fail"
