#!/usr/bin/env bash
# Stack guards — fail CI when code breaks the standard.
# Guards 1, 1b, 2, 3, 3b and 5 are stack policies, run only when the site's config opts into them
# (policies, passed in SHIP_GATE_POLICIES by prepare.mjs). The rest apply to every site.
set -uo pipefail

fail=0
# err GUARD MESSAGE — a guard exempted in ship-gate.config.json (guardExemptions, validated
# by prepare.mjs and passed in SHIP_GATE_EXEMPT) warns instead of failing until its date.
EXEMPT=" ${SHIP_GATE_EXEMPT:-} "
# Committed secrets and anything that skips the PR gate are never exempt.
NEVER_EXEMPT=" posthog-key env-file push-to-main "
err() {
  if [[ "$EXEMPT" == *" $1 "* && "$NEVER_EXEMPT" != *" $1 "* ]]; then echo "::warning::[exempt: $1] $2"; else echo "::error::$2"; fail=1; fi
}
# scan PATTERN PATH... — grep only paths that exist (a missing path makes grep exit 2 and hide real matches)
scan() { local pat=$1; shift; local paths=(); for p in "$@"; do [ -e "$p" ] && paths+=("$p"); done
  [ ${#paths[@]} -eq 0 ] && return 1; grep -rInE "$pat" "${paths[@]}"; }
DIRS="src public"
# Runs from the site directory (the action's working-directory). Repo-wide files
# (workflows, Dependabot/Renovate config) are read from the repository root.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
POLICIES=" ${SHIP_GATE_POLICIES:-} "
policy() { [[ "$POLICIES" == *" $1 "* ]]; }

# secrets_missing "NAME..." — prints what the wrangler config's secrets.required lacks, or
# that there is no readable wrangler config; prints nothing when every name is declared.
secrets_missing() {
  NEED="$1" node -e '
  const fs = require("fs");
  const f = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find((n) => fs.existsSync(n));
  if (!f) { console.log("no wrangler config"); process.exit(); }
  const src = fs.readFileSync(f, "utf8");
  let req = [];
  if (f.endsWith(".toml")) {
    const sec = src.split(/^\s*\[/m).find((b) => /^secrets\]/.test(b)) ?? "";
    const m = sec.match(/^\s*required\s*=\s*\[([^\]]*)\]/m);
    req = m ? [...m[1].matchAll(/["\x27]([^"\x27]+)["\x27]/g)].map((x) => x[1]) : [];
  } else {
    const json = src.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === "\"" ? m : ""))
      .replace(/,(\s*[}\]])/g, "$1");
    try { req = JSON.parse(json).secrets?.required ?? []; } catch { console.log(`${f} is not valid JSON`); process.exit(); }
  }
  const miss = process.env.NEED.split(" ").filter((n) => !req.includes(n));
  if (miss.length) console.log(`${f} secrets.required lacks ${miss.join(", ")}`);
' 2>&1
}

if policy posthog-server-only; then

# 1. [posthog-server-only] PostHog: server-side only, EU Cloud, key never public.
#    Direct PostHog use (SDK, host, key) is allowed only in server paths; everything else calls a wrapper there.
#    Markdown content under src/content may name posthog.com in prose (a privacy disclosure).
SERVER_PATHS='^src/(lib/server|pages/api|actions|middleware)'
grep -qE '"(posthog-js|posthog-react-native|@posthog/react)"' package.json \
  && err posthog-client "Client PostHog SDK in package.json — use posthog-node, server-side only."
scan 'posthog\.init\(|/static/array\.js' $DIRS && err posthog-client "Client-side PostHog snippet found."
scan 'PUBLIC_POSTHOG' src astro.config.* .env.example wrangler.* \
  && err posthog-public-var "PostHog variable uses PUBLIC_ prefix — it would ship to the browser."
scan '(us|us-assets|app)\.(i\.)?posthog\.com' src astro.config.* wrangler.* \
  && err posthog-us-host "PostHog US host found — standard is EU Cloud (eu.i.posthog.com)."
scan 'ph[cx]_[A-Za-z0-9]{20,}' src public astro.config.* wrangler.* \
  && err posthog-key "Hard-coded PostHog key (phc_ project or phx_ personal) — keys live only in Worker secrets."
while IFS= read -r f; do
  echo "$f" | grep -qE "$SERVER_PATHS" \
    || err posthog-client "$f uses PostHog directly outside server paths (src/lib/server, src/pages/api, src/actions, src/middleware)."
done < <({ grep -rlE "posthog-node|posthog\.com|POSTHOG_|new PostHog\(" src 2>/dev/null | grep -vE '^src/content/.*\.mdx?$'
  # Content files (a privacy policy's disclosure names posthog.com) are prose: only code-shaped
  # PostHog use counts there, ingestion hosts included (i.posthog.com, eu.i., us-assets.).
  grep -rlE "posthog-node|i\.posthog\.com|-assets\.(i\.)?posthog\.com|POSTHOG_|new PostHog\(" src/content \
    --include='*.md' --include='*.mdx' 2>/dev/null; } | sort -u)
# posthog-node on Workers must flush before the request ends, or events are silently dropped.
while IFS= read -r f; do
  grep -qE '\.(shutdown|flush)\(' "$f" \
    || echo "::warning::$f imports posthog-node without flush()/shutdown() — events can be dropped on Workers."
done < <(grep -rlE "from ['\"]posthog-node['\"]" src 2>/dev/null)
grep -q '"posthog-node"' package.json || echo "::warning::posthog-node not installed — this repo sends no server-side events yet."
# Every PostHog event must carry the deploy environment, so preview traffic stays out of production data.
while IFS= read -r f; do
  grep -q '__DEPLOY_ENV__' "$f" \
    || err posthog-env-tag "$f uses posthog-node without tagging events with __DEPLOY_ENV__ — preview traffic would pollute production analytics."
done < <(grep -rlE "from ['\"]posthog-node['\"]" src 2>/dev/null)
fi

if policy posthog-hybrid; then

# 1b. [posthog-hybrid] PostHog in the browser on every page and on the server, EU Cloud.
#     The browser init (snippet or posthog-js) lives in a component the base layout renders;
#     posthog-node stays in server paths. The project key comes from PUBLIC_POSTHOG_KEY, never code.
#     Templates: templates/caller/posthog/ in the Ship Gate repo.
SERVER_PATHS='^src/(lib/server|pages/api|actions|middleware)'
EMBED="${SHIP_GATE_POSTHOG_EMBED:-snippet}"
grep -q '"posthog-node"' package.json \
  || err posthog-server "posthog-node is not a dependency — posthog-hybrid sends server-side events too. Copy src/lib/server/analytics.ts from templates/caller/posthog."
if [ "$EMBED" = npm ]; then
  grep -q '"posthog-js"' package.json \
    || err posthog-missing "posthog.embed is \"npm\" but posthog-js is not a dependency."
fi
# Every browser init tags its events with the deploy environment, like the server's.
inits="$(grep -rlE 'posthog\.init\(' src 2>/dev/null | grep -vE "$SERVER_PATHS" || true)"
[ -n "$inits" ] \
  || err posthog-missing "No posthog.init( in src — add the PostHog component (templates/caller/posthog) to the base layout's <head>."
while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -q '__DEPLOY_ENV__' "$f" \
    || err posthog-env-tag "$f initialises PostHog without registering environment: __DEPLOY_ENV__ — preview traffic would pollute production analytics."
done <<<"$inits"
scan 'PUBLIC_POSTHOG[A-Z_]*(PERSONAL|SECRET|PHX)' src astro.config.* .env.example wrangler.* \
  && err posthog-public-var "A PostHog personal key or secret uses the PUBLIC_ prefix — it would ship to the browser. Only PUBLIC_POSTHOG_KEY (the project key) is public."
scan '(us|us-assets|app)\.(i\.)?posthog\.com' src astro.config.* wrangler.* \
  && err posthog-us-host "PostHog US host found — standard is EU Cloud (eu.i.posthog.com)."
scan 'ph[cx]_[A-Za-z0-9]{20,}' src public astro.config.* wrangler.* \
  && err posthog-key "Hard-coded PostHog key (phc_ project or phx_ personal) — the project key comes from PUBLIC_POSTHOG_KEY, personal keys never leave PostHog."
while IFS= read -r f; do
  echo "$f" | grep -qE "$SERVER_PATHS" \
    || err posthog-server "$f imports posthog-node outside server paths (src/lib/server, src/pages/api, src/actions, src/middleware)."
  grep -qE '\.(shutdown|flush)\(' "$f" \
    || echo "::warning::$f imports posthog-node without flush()/shutdown() — events can be dropped on Workers."
  grep -q '__DEPLOY_ENV__' "$f" \
    || err posthog-env-tag "$f uses posthog-node without tagging events with __DEPLOY_ENV__ — preview traffic would pollute production analytics."
done < <(grep -rlE "from ['\"]posthog-node['\"]" src 2>/dev/null)
# The Worker's runtime secrets are declared in the wrangler config (secrets.required), so
# wrangler deploy and versions upload (every preview) fail when one is unset, instead of
# shipping a Worker that silently sends nothing. A warning in v3; an error from v4.
need="POSTHOG_API_KEY"
policy turnstile-forms && need="$need ${SHIP_GATE_TURNSTILE_SECRET:-TURNSTILE_SECRET_KEY}"
missing="$(secrets_missing "$need")"
[ -z "$missing" ] || echo "::warning::posthog-hybrid: $missing. Declare the Worker's runtime secrets in the wrangler config (secrets.required listing ${need// /, } and any other secret the Worker reads) so a deploy or preview upload without them fails loudly. Note that wrangler dev then loads only the listed secrets. This becomes an error in Ship Gate v4."
fi

# 2. [tags-via-zaraz] No third-party tags loaded directly. All tags, GTM included, go through Zaraz. No sGTM in this stack.
#    HubSpot form embeds (js-*.hsforms.net) are forms, not tags: they are the portfolio's form
#    standard until HubSpot's forms API is available, so they are allowed. HubSpot tracking is not.
BLOCKED='googletagmanager\.com/(gtm|gtag)|google-analytics\.com|connect\.facebook\.net|static\.hotjar\.com|snap\.licdn\.com|analytics\.tiktok\.com|clarity\.ms/tag|js\.hs-scripts\.com|js\.hs-analytics\.net|["'\''\`]GTM-[A-Z0-9]{4,}["'\''\`]'
# A host named in a _headers comment or in the CSP loads nothing: a Zaraz tool that runs client-side
# (Clarity as Custom HTML) needs its hosts in the CSP, and the file explains why in comments.
tag_scan() { scan "$BLOCKED" $DIRS | grep -vE '(^|/)_headers:[0-9]+:[[:space:]]*(#|Content-Security-Policy(-Report-Only)?:)'; }
policy tags-via-zaraz && tag_scan && err direct-tags "Third-party tag loaded directly. Route it through Zaraz (GTM runs as a Zaraz tool)."

# 3. [turnstile-forms] Every form has Turnstile (opt out non-public forms with: turnstile-exempt: reason).
policy turnstile-forms && while IFS= read -r f; do
  grep -q 'turnstile-exempt' "$f" && continue
  grep -qiE 'cf-turnstile|<Turnstile' "$f" || err turnstile "$f has a <form> without Turnstile."
done < <(grep -rlE '<form[ >]' src --include='*.astro' --include='*.tsx' --include='*.jsx' --include='*.svelte' --include='*.vue' 2>/dev/null)

# 3b. [turnstile-forms] Turnstile is verified server-side, so the Worker's secret is declared in
#     secrets.required: a deploy or preview upload without it then fails instead of rejecting every
#     submission. posthog-hybrid's check above already covers it. A warning.
if policy turnstile-forms && ! policy posthog-hybrid && scan 'cf-turnstile|<Turnstile' src >/dev/null; then
  need="${SHIP_GATE_TURNSTILE_SECRET:-TURNSTILE_SECRET_KEY}"
  missing="$(secrets_missing "$need")"
  [ -z "$missing" ] || echo "::warning::turnstile-forms: $missing. Declare the Turnstile secret in the wrangler config (secrets.required listing $need and any other secret the Worker reads) so a deploy or preview upload without it fails loudly."
fi

# 4. No committed env or Worker secret files.
git -C "$ROOT" ls-files | grep -E '(^|/)(\.env|\.dev\.vars)(\..+)?$' | grep -vE '\.example$' && err env-file "Env/secret file committed. Remove it and rotate its secrets."

# 5. [workers-builds-only] Deploy target is Workers, not Pages.
policy workers-builds-only && for w in wrangler.toml wrangler.json wrangler.jsonc; do
  [ -f "$w" ] && grep -q 'pages_build_output_dir' "$w" && err pages-config "$w is Pages config; the standard is Workers."
done

# 6. Node version pinned exactly, at or above Astro 7's floor (22.12.0).
NODE_FILE=""
for f in .nvmrc .node-version; do [ -f "$f" ] && { NODE_FILE=$f; break; }; done
if [ -z "$NODE_FILE" ]; then
  err node-pin "No .nvmrc or .node-version — pin the Node version (Astro 7 needs 22.12.0 or later)."
else
  v="$(tr -d ' \r\n' < "$NODE_FILE")"; v="${v#v}"
  if [[ "$v" =~ ^([0-9]+)(\.([0-9]+))?(\.([0-9]+))?$ ]]; then
    maj=${BASH_REMATCH[1]}; min=${BASH_REMATCH[3]:-}; patch=${BASH_REMATCH[5]:-}
    if [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ -n "$min" ] && [ "$min" -lt 12 ]; }; then
      err node-pin "$NODE_FILE pins Node $v, below Astro 7's floor of 22.12.0."
    elif [ -z "$patch" ]; then
      echo "::warning::$NODE_FILE pins Node $v, not an exact version. Pin major.minor.patch (22.12.0 or later), the same value as NODE_VERSION in Workers Builds, so CI and deploys agree."
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
    && err push-to-main "$name pushes to main directly, bypassing the PR gate. Have it open a pull request instead."
  # [workers-builds-only] Cloudflare Workers Builds is the only deployer; no Cloudflare credentials belong in GitHub.
  policy workers-builds-only && grep -qE 'CLOUDFLARE_API_TOKEN|cloudflare/wrangler-action|wrangler(@[0-9.]+)?[[:space:]]+(deploy|publish|secret|pages|r2|kv|d1)' "$wf" \
    && err cloudflare-in-workflows "$name uses a Cloudflare API token or wrangler write command. Workers Builds is the only deployer. If this is unavoidable for now, add a dated guardExemptions entry for cloudflare-in-workflows."
done
# Lighthouse reports stay private: temporary public storage publishes them at a public URL.
while IFS= read -r f; do
  err public-lighthouse "${f#"$ROOT"/} uploads Lighthouse reports to public storage. Use the filesystem target."
done < <(grep -rlE 'temporaryPublicStorage:[[:space:]]*true|temporary-public-storage' \
  "$ROOT/.github" "$ROOT"/lighthouserc* "$ROOT"/.lighthouserc* lighthouserc* .lighthouserc* 2>/dev/null | sort -u)

# 8. One dependency bot. Both open duplicate PRs for every update.
if [ -f "$ROOT/.github/dependabot.yml" ] && ls "$ROOT"/renovate.json* "$ROOT"/.renovaterc* "$ROOT"/.github/renovate.json* >/dev/null 2>&1; then
  echo "::warning::Both Dependabot and Renovate are configured — every update arrives twice. Keep one (Ship Gate's templates use Dependabot)."
fi

# 9. Tailwind 4 reads its config from CSS (@theme). A tailwind.config.* file beside Tailwind 4 is
#    ignored unless a stylesheet loads it with @config: a half-finished v3 migration. A warning.
tw_major="$(node -e 'const p = require("./package.json"); const v = { ...p.dependencies, ...p.devDependencies }.tailwindcss;
  const m = /(\d+)/.exec(v ?? ""); if (m) console.log(m[1]);' 2>/dev/null)"
if [ -n "$tw_major" ] && [ "$tw_major" -ge 4 ]; then
  for f in tailwind.config.js tailwind.config.cjs tailwind.config.mjs tailwind.config.ts; do
    [ -f "$f" ] || continue
    scan '@config[[:space:]]' src >/dev/null \
      || echo "::warning::$f sits beside Tailwind $tw_major, which ignores it unless a stylesheet loads it with @config. Move its theme into CSS (@theme) and delete it."
  done
fi

[ "$fail" -eq 0 ] && echo "All stack guards passed."
exit "$fail"
