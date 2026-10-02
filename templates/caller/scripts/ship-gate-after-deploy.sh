#!/usr/bin/env bash
# Ship Gate's post-deploy check inside Cloudflare Workers Builds, straight after the
# deploy, so no GitHub Actions runner waits on it. Append it to the Workers Builds
# deploy command (dashboard → Settings → Build), e.g.
#   npx wrangler deploy && bash scripts/ship-gate-after-deploy.sh
# A failure marks the production build red: the deploy has already happened.
#
# SHIP_GATE_ROLLBACK=1 (a build variable): on a failed check, roll production back to
# the previous version with `wrangler rollback`, using the API token Workers Builds
# already gives the deploy command. Skipped when this commit changed wrangler.jsonc /
# wrangler.toml or a migration, since a rollback cannot cross a binding change and a
# D1 migration only goes forward. The build still ends red either way.
# AUTOMATION_TOKEN (a build secret, optional): after a rollback, send the repository a
# `deploy-failed` repository_dispatch so its revert workflow opens a revert pull request
# and main matches production again. The token never reaches the log.
set -euo pipefail
[ -n "${WORKERS_CI:-}" ] || { echo "Ship Gate: not in Workers Builds; nothing to do."; exit 0; }
# SHIP_GATE_HOME: a local Ship-Gate checkout, for testing this script.
dir="${SHIP_GATE_HOME:-}"
if [ -z "$dir" ]; then
  # Ship-Gate is public (v3.10.0): no token needed. A leftover SHIP_GATE_READ_TOKEN is still used.
  tag="$(grep -m1 -oE 'pauljosephdp/Ship-Gate@v[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml 2>/dev/null | cut -d@ -f2 || true)"
  url="https://github.com/pauljosephdp/Ship-Gate.git"
  [ -z "${SHIP_GATE_READ_TOKEN:-}" ] || url="https://x-access-token:${SHIP_GATE_READ_TOKEN}@github.com/pauljosephdp/Ship-Gate.git"
  dir="$(mktemp -d)"
  if [ -z "$tag" ] || ! git clone -q --depth 1 --branch "$tag" "$url" "$dir" 2>/dev/null; then
    echo "::error::Ship Gate ${tag:-<no pin in .github/workflows/ci.yml>} could not be fetched; the post-deploy check cannot run."; exit 1
  fi
fi
sha="${WORKERS_CI_COMMIT_SHA:?}"
if SHA="$sha" WAIT_MINUTES="${SHIP_GATE_WAIT_MINUTES:-5}" bash "$dir/scripts/post-deploy.sh" ship-gate.config.json; then
  exit 0
fi
echo "::error::Ship Gate post-deploy check failed for $sha."
[ "${SHIP_GATE_ROLLBACK:-}" = 1 ] || { echo "Roll back (wrangler rollback), then fix forward."; exit 1; }

# The files this commit changed. Workers Builds may clone with depth 1, so the parent can
# be missing: deepen by one, else ask the GitHub API (AUTOMATION_TOKEN); only when neither
# works, play safe and treat it as a binding change (no rollback, and say why).
repo="$(git config --get remote.origin.url | sed -E 's#^(https://[^/]+/|git@[^:]+:)##; s#\.git$##' || true)"
git rev-parse -q --verify HEAD~1 >/dev/null 2>&1 || git fetch -q --deepen=1 origin 2>/dev/null || true
if git rev-parse -q --verify HEAD~1 >/dev/null 2>&1; then
  changed="$(git diff --name-only HEAD~1 HEAD)"
elif [ -n "${AUTOMATION_TOKEN:-}" ] && changed="$(curl -fsS -H "Authorization: Bearer $AUTOMATION_TOKEN" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/commits/$sha" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const f of JSON.parse(d).files||[])console.log(f.filename)})')"; then
  :
else
  echo "::warning::Cannot list this commit's files (shallow clone, no AUTOMATION_TOKEN): treating it as a binding change."
  changed="wrangler.jsonc"
fi
if printf '%s\n' "$changed" | grep -qE '(^|/)(wrangler\.(jsonc?|toml)|migrations/)'; then
  echo "::error::Not rolling back: this commit changed the Wrangler config or a migration, which a rollback cannot undo. Fix forward."
  exit 1
fi
echo "Rolling production back to the previous version."
if npx --no-install wrangler rollback --message "ship-gate post-deploy failed (${sha:0:7})"; then
  echo "Rolled back. Production is on the previous version; main still holds $sha until it is reverted."
  if [ -n "${AUTOMATION_TOKEN:-}" ]; then
    if curl -fsS -o /dev/null -X POST "https://api.github.com/repos/$repo/dispatches" \
      -H "Authorization: Bearer $AUTOMATION_TOKEN" -H "Accept: application/vnd.github+json" \
      -d "{\"event_type\":\"deploy-failed\",\"client_payload\":{\"sha\":\"$sha\",\"rolled_back\":true}}"; then
      echo "Asked $repo to open a revert pull request (repository_dispatch deploy-failed)."
    else
      echo "::warning::Could not send repository_dispatch; revert $sha on main by hand."
    fi
  else
    echo "::warning::No AUTOMATION_TOKEN build secret: revert $sha on main so the next deploy does not ship it again."
  fi
else
  echo "::error::wrangler rollback failed; roll back from the dashboard (Deployments) and fix forward."
fi
exit 1
