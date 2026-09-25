#!/usr/bin/env bash
# Publishes the release named by the newest version heading in CHANGELOG.md, once.
# self-test.yml runs it on every push to main after every check passed, so a
# release only ever tags a green commit. Adding a "## vX.Y.Z — date" section to
# CHANGELOG.md in a PR is how a release is made; merging it publishes the release.
#
#   release.sh            create the tag and GitHub release (needs GH_TOKEN, GITHUB_SHA)
#   DRY_RUN=1 release.sh  print the version and notes; touch nothing
#
# A heading marked "(not released)", or a version already released, publishes nothing.
set -euo pipefail

CHANGELOG="${CHANGELOG:-CHANGELOG.md}"
heading="$(grep -m1 -E '^## v[0-9]+\.[0-9]+\.[0-9]+( |$)' "$CHANGELOG" || true)"
[ -n "$heading" ] || { echo "::error::No \"## vX.Y.Z\" heading in $CHANGELOG."; exit 1; }
version="$(sed -E 's/^## (v[0-9]+\.[0-9]+\.[0-9]+).*/\1/' <<<"$heading")"
if [[ "$heading" == *"not released"* ]]; then
  echo "$version is marked not released in $CHANGELOG; nothing to publish."
  exit 0
fi

notes="$(awk -v h="$heading" '$0 == h { f = 1; next } /^## v[0-9]/ { f = 0 } f' "$CHANGELOG" \
  | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"
[ -n "$notes" ] || { echo "::error::$version has no notes under its heading in $CHANGELOG."; exit 1; }

if [ -n "${DRY_RUN:-}" ]; then
  printf 'version=%s\n---\n%s\n' "$version" "$notes"
  exit 0
fi

: "${GITHUB_SHA:?GITHUB_SHA must name the commit to tag}"
if gh release view "$version" >/dev/null 2>&1; then
  echo "$version is already released; nothing to do."
  exit 0
fi
# An existing tag is kept: the release attaches to it rather than moving it.
gh release create "$version" --target "$GITHUB_SHA" --title "$version" --notes "$notes"
echo "Released $version at $GITHUB_SHA."
