#!/usr/bin/env bash
# Stack guards — fail CI when code breaks the Gallivant portfolio standard.
set -uo pipefail

fail=0
err() { echo "::error::$1"; fail=1; }
# scan PATTERN PATH... — grep only paths that exist (a missing path makes grep exit 2 and hide real matches)
scan() { local pat=$1; shift; local paths=(); for p in "$@"; do [ -e "$p" ] && paths+=("$p"); done
  [ ${#paths[@]} -eq 0 ] && return 1; grep -rInE "$pat" "${paths[@]}"; }
DIRS="src public"
# Runs from the site directory (the action's working-directory). Repo-wide files
# (workflows, Dependabot/Renovate config) are read from the repository root.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 1. PostHog: server-side only, EU Cloud, key never public.
#    Direct PostHog use (SDK, host, key) is allowed only in server paths; everything else calls a wrapper there.
SERVER_PATHS='^src/(lib/server|pages/api|actions|middleware)'
grep -qE '"(posthog-js|posthog-react-native|@posthog/react)"' package.json \
  && err "Client PostHog SDK in package.json — use posthog-node, server-side only."
scan 'posthog\.init\(|/static/array\.js' $DIRS && err "Client-side PostHog snippet found."
scan 'PUBLIC_POSTHOG' src astro.config.* .env.example wrangler.* \
  && err "PostHog variable uses PUBLIC_ prefix — it would ship to the browser."
scan '(us|us-assets|app)\.(i\.)?posthog\.com' src astro.config.* wrangler.* \
  && err "PostHog US host found — standard is EU Cloud (eu.i.posthog.com)."
scan 'ph[cx]_[A-Za-z0-9]{20,}' src public astro.config.* wrangler.* \
  && err "Hard-coded PostHog key (phc_ project or phx_ personal) — keys live only in Worker secrets."
while IFS= read -r f; do
  echo "$f" | grep -qE "$SERVER_PATHS" \
    || err "$f uses PostHog directly outside server paths (src/lib/server, src/pages/api, src/actions, src/middleware)."
done < <(grep -rlE "posthog-node|posthog\.com|POSTHOG_|new PostHog\(" src 2>/dev/null)
# posthog-node on Workers must flush before the request ends, or events are silently dropped.
while IFS= read -r f; do
  grep -qE '\.(shutdown|flush)\(' "$f" \
    || echo "::warning::$f imports posthog-node without flush()/shutdown() — events can be dropped on Workers."
done < <(grep -rlE "from ['\"]posthog-node['\"]" src 2>/dev/null)
grep -q '"posthog-node"' package.json || echo "::warning::posthog-node not installed — this repo sends no server-side events yet."
# Every PostHog event must carry the deploy environment, so preview traffic stays out of production data.
while IFS= read -r f; do
  grep -q '__DEPLOY_ENV__' "$f" \
    || err "$f uses posthog-node without tagging events with __DEPLOY_ENV__ — preview traffic would pollute production analytics."
done < <(grep -rlE "from ['\"]posthog-node['\"]" src 2>/dev/null)

# 2. No third-party tags loaded directly. All tags, GTM included, go through Zaraz. No sGTM in this stack.
BLOCKED='googletagmanager\.com/(gtm|gtag)|google-analytics\.com|connect\.facebook\.net|static\.hotjar\.com|snap\.licdn\.com|analytics\.tiktok\.com|clarity\.ms/tag|www\.clarity\.ms|js\.hs-scripts\.com|js\.hs-analytics\.net'
scan "$BLOCKED" $DIRS && err "Third-party tag loaded directly. Route it through Zaraz (GTM runs as a Zaraz tool)."

# 3. Every form has Turnstile (opt out non-public forms with: turnstile-exempt: reason).
while IFS= read -r f; do
  grep -q 'turnstile-exempt' "$f" && continue
  grep -qiE 'cf-turnstile|<Turnstile' "$f" || err "$f has a <form> without Turnstile."
done < <(grep -rlE '<form[ >]' src --include='*.astro' --include='*.tsx' --include='*.jsx' --include='*.svelte' --include='*.vue' 2>/dev/null)

# 4. No committed env or Worker secret files.
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars)(\..+)?$' | grep -vE '\.example$' && err "Env/secret file committed. Remove it and rotate its secrets."

# 5. Deploy target is Workers, not Pages.
for w in wrangler.toml wrangler.json wrangler.jsonc; do
  [ -f "$w" ] && grep -q 'pages_build_output_dir' "$w" && err "$w is Pages config; the standard is Workers."
done

# 6. Node version pinned, at or above Astro 7's floor (22.12.0).
NODE_FILE=""
for f in .nvmrc .node-version; do [ -f "$f" ] && { NODE_FILE=$f; break; }; done
if [ -z "$NODE_FILE" ]; then
  err "No .nvmrc or .node-version — pin the Node version (Astro 7 needs 22.12.0 or later)."
else
  v="$(tr -d ' \r\n' < "$NODE_FILE")"; v="${v#v}"
  if [[ "$v" =~ ^([0-9]+)(\.([0-9]+))?(\.([0-9]+))?$ ]]; then
    maj=${BASH_REMATCH[1]}; min=${BASH_REMATCH[3]:-}
    if [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ -n "$min" ] && [ "$min" -lt 12 ]; }; then
      err "$NODE_FILE pins Node $v, below Astro 7's floor of 22.12.0."
    elif [ "$maj" -eq 22 ] && [ -z "$min" ]; then
      echo "::warning::$NODE_FILE pins Node 22 without a minor version. Pin 22.12.0 or later exactly, so CI and Workers Builds agree."
    fi
  else
    echo "::warning::$NODE_FILE holds \"$v\", not a version number. Pin an exact version so CI and Workers Builds agree."
  fi
fi

# 7. Workflows: nothing bypasses the gate, deploys, or publishes reports.
for wf in "$ROOT"/.github/workflows/*.yml "$ROOT"/.github/workflows/*.yaml; do
  [ -f "$wf" ] || continue
  name="${wf#"$ROOT"/}"
  # Pushing to main skips the PR and its required checks. No exemption: open a PR instead.
  grep -qE 'git push[^#]*(HEAD:main|HEAD:refs/heads/main|origin main([^-A-Za-z0-9_/]|$))' "$wf" \
    && err "$name pushes to main directly, bypassing the PR gate. Have it open a pull request instead."
  # Cloudflare Workers Builds is the only deployer; no Cloudflare credentials belong in GitHub.
  if grep -qE 'CLOUDFLARE_API_TOKEN|cloudflare/wrangler-action|wrangler(@[0-9.]+)?[[:space:]]+(deploy|publish|secret|pages|r2|kv|d1)' "$wf"; then
    reason="$(grep -oE 'ship-gate-allow-cloudflare:[[:space:]]*.{10,}' "$wf" | head -1)"
    if [ -n "$reason" ]; then
      echo "::warning::$name uses Cloudflare credentials under a written exemption — ${reason#ship-gate-allow-cloudflare:}"
    else
      err "$name uses a Cloudflare API token or wrangler write command. Workers Builds is the only deployer. If this is unavoidable, add a comment: # ship-gate-allow-cloudflare: <reason>"
    fi
  fi
done
# Lighthouse reports stay private: temporary public storage publishes them at a public URL.
while IFS= read -r f; do
  err "${f#"$ROOT"/} uploads Lighthouse reports to public storage. Use the filesystem target."
done < <(grep -rlE 'temporaryPublicStorage:[[:space:]]*true|temporary-public-storage' \
  "$ROOT/.github" "$ROOT"/lighthouserc* "$ROOT"/.lighthouserc* lighthouserc* .lighthouserc* 2>/dev/null | sort -u)

# 8. One dependency bot. Both open duplicate PRs for every update.
if [ -f "$ROOT/.github/dependabot.yml" ] && ls "$ROOT"/renovate.json* "$ROOT"/.renovaterc* "$ROOT"/.github/renovate.json* >/dev/null 2>&1; then
  echo "::warning::Both Dependabot and Renovate are configured — every update arrives twice. Keep one (Ship Gate's templates use Dependabot)."
fi

[ "$fail" -eq 0 ] && echo "All stack guards passed."
exit "$fail"
