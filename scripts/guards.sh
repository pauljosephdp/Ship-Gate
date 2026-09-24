#!/usr/bin/env bash
# Stack guards — fail CI when code breaks the Gallivant portfolio standard.
set -uo pipefail

fail=0
err() { echo "::error::$1"; fail=1; }
# scan PATTERN PATH... — grep only paths that exist (a missing path makes grep exit 2 and hide real matches)
scan() { local pat=$1; shift; local paths=(); for p in "$@"; do [ -e "$p" ] && paths+=("$p"); done
  [ ${#paths[@]} -eq 0 ] && return 1; grep -rInE "$pat" "${paths[@]}"; }
DIRS="src public"

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
BLOCKED='googletagmanager\.com/(gtm|gtag)|google-analytics\.com|connect\.facebook\.net|static\.hotjar\.com|snap\.licdn\.com|analytics\.tiktok\.com'
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

# 6. Node version pinned.
[ -f .nvmrc ] || err ".nvmrc missing — pin the Node version."

[ "$fail" -eq 0 ] && echo "All stack guards passed."
exit "$fail"
