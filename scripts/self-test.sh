#!/usr/bin/env bash
# Ship Gate self-test. Proves every guard and config rule still fires on bad input
# and stays quiet on good input. Runs on every PR to this repo; a guard that stops
# biting would otherwise let CI stay green while enforcing nothing.
#
# Fixtures are built at run time, so no key-shaped strings are ever committed.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARDS="$HERE/guards.sh"
PREPARE="$HERE/prepare.mjs"
FUTURE="$(date -u -d '+90 days' +%F 2>/dev/null || date -u -v+90d +%F)"
PAST="2020-01-01"
PH="ph""c_"   # split so this file itself never matches a key pattern
pass=0; failn=0

# A conforming site: every rule satisfied.
baseline() {
  local d; d="$(mktemp -d)"
  cd "$d" || exit 1
  git init -q
  mkdir -p src/lib/server src/pages
  echo "22.12.0" > .nvmrc
  cat > package.json <<'JSON'
{
  "type": "module",
  "scripts": { "check": "astro check", "build": "astro build", "preview": "astro preview",
               "test": "vitest run", "check:canon": "node scripts/canon.mjs",
               "migrate:local": "wrangler d1 migrations apply db --local",
               "migrate:remote": "wrangler d1 migrations apply db --remote", "deploy": "wrangler deploy" },
  "dependencies": { "posthog-node": "^5.0.0" },
  "devDependencies": { "@astrojs/check": "1" }
}
JSON
  cat > src/lib/server/analytics.ts <<'TS'
import { PostHog } from 'posthog-node';
export function track(env: { POSTHOG_API_KEY?: string }, ctx: { waitUntil(p: Promise<unknown>): void }, event: string) {
  if (!env.POSTHOG_API_KEY) return;
  const ph = new PostHog(env.POSTHOG_API_KEY, { host: 'https://eu.i.posthog.com', flushAt: 1, flushInterval: 0 });
  ph.capture({ distinctId: 'server', event, properties: { environment: __DEPLOY_ENV__ } });
  ctx.waitUntil(ph.shutdown());
}
TS
  cat > src/pages/contact.astro <<'ASTRO'
<form method="post"><div class="cf-turnstile" data-sitekey="x"></div></form>
ASTRO
  cat > src/pages/admin.astro <<'ASTRO'
<!-- turnstile-exempt: internal admin form behind Cloudflare Access -->
<form method="post"></form>
ASTRO
  echo '{ "name": "site", "main": "dist/_worker.js/index.js" }' > wrangler.jsonc
  cat > ship-gate.config.json <<JSON
{ "siteUrl": "https://example.com", "pages": ["/", "/contact/"], "formPages": ["/contact/"] }
JSON
  echo "$d"
}

commit_all() { git add -A >/dev/null 2>&1; }
# cfg JSON-FRAGMENT — a config with the required fields plus the fragment
cfg() { echo "{\"siteUrl\":\"https://example.com\",\"pages\":[\"/\"]${1:+,$1}}" > ship-gate.config.json; }
# wf NAME CONTENT — add a workflow at the repo root
wf() { mkdir -p .github/workflows && printf '%s\n' "$2" > ".github/workflows/$1"; }

# expect_guard NAME EXPECT(pass|substring) SETUP-COMMANDS...
expect_guard() {
  local name=$1 expect=$2; shift 2
  local d out code; d="$(baseline)"; cd "$d" || return
  eval "$@"; commit_all
  out="$(bash "$GUARDS" 2>&1)"; code=$?
  check "$name" "$expect" "$code" "$out"
  rm -rf "$d"
}

expect_prepare() {
  local name=$1 expect=$2; shift 2
  local d out code; d="$(baseline)"; cd "$d" || return
  eval "$@"
  out="$(GITHUB_ENV= SHIP_GATE_DIR="$d/.sg" node "$PREPARE" verify 2>&1)"; code=$?
  check "$name" "$expect" "$code" "$out"
  rm -rf "$d"
}

check() {
  local name=$1 expect=$2 code=$3 out=$4
  if [ "$expect" = "pass" ]; then
    if [ "$code" -eq 0 ]; then ok "$name"; else bad "$name" "expected pass, got exit $code" "$out"; fi
  else
    if [ "$code" -ne 0 ] && grep -qF -- "$expect" <<<"$out"; then ok "$name"
    else bad "$name" "expected failure containing: $expect (exit $code)" "$out"; fi
  fi
}
ok()  { echo "  ✓ $1"; pass=$((pass+1)); }
bad() { echo "  ✗ $1 — $2"; echo "$3" | sed 's/^/      /'; failn=$((failn+1)); }

echo "Guards"
expect_guard "conforming site passes"             pass ":"
expect_guard "client SDK in package.json"         "Client PostHog SDK"        "sed -i 's/\"dependencies\": {/\"dependencies\": { \"posthog-js\": \"1\",/' package.json"
expect_guard "client snippet"                     "Client-side PostHog snippet" "echo 'posthog.init(\"x\")' > src/pages/snippet.js"
expect_guard "PUBLIC_ PostHog variable"           "PUBLIC_ prefix"            "echo 'const k = import.meta.env.PUBLIC_POSTHOG_KEY' > src/pages/k.ts"
expect_guard "US PostHog host"                    "US host"                   "sed -i 's#eu.i.posthog.com#us.i.posthog.com#' src/lib/server/analytics.ts"
expect_guard "hard-coded PostHog key"             "Hard-coded PostHog key"    "echo \"const k = '${PH}abcdefghijklmnopqrstuvwxyz0123'\" > src/lib/server/key.ts"
expect_guard "posthog-node outside server paths"  "outside server paths"      "mkdir -p src/components && echo \"import { PostHog } from 'posthog-node'; __DEPLOY_ENV__; x.shutdown()\" > src/components/w.ts"
expect_guard "events not tagged with environment" "__DEPLOY_ENV__"            "sed -i 's/environment: __DEPLOY_ENV__/environment: \"x\"/' src/lib/server/analytics.ts"
expect_guard "GTM loaded directly"                "Third-party tag"           "echo '<script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-X\"></script>' > src/pages/gtm.astro"
expect_guard "form without Turnstile"             "without Turnstile"         "echo '<form method=\"post\"></form>' > src/pages/signup.astro"
expect_guard "committed env file"                 "Env/secret file committed" "echo 'A=1' > .env"
expect_guard "Pages config instead of Workers"    "Pages config"              "echo 'pages_build_output_dir = \"dist\"' > wrangler.toml"
expect_guard "Node version not pinned"            "No .nvmrc or .node-version" "rm .nvmrc"
expect_guard ".node-version accepted"             pass                        "rm .nvmrc && echo 24.1.0 > .node-version"
expect_guard "Node below Astro 7 floor (major)"   "below Astro 7"             "echo 20 > .nvmrc"
expect_guard "Node below Astro 7 floor (minor)"   "below Astro 7"             "echo v22.11.0 > .nvmrc"
expect_guard "Clarity loaded directly"            "Third-party tag"           "echo '<script src=\"https://www.clarity.ms/tag/abc\"></script>' > src/pages/c.astro"
expect_guard "HubSpot tracking loaded directly"   "Third-party tag"           "echo '<script src=\"https://js.hs-scripts.com/1.js\"></script>' > src/pages/h.astro"
expect_guard "workflow pushes to main"            "pushes to main"            "wf auto.yml '      - run: git push origin HEAD:main'"
expect_guard "workflow pushes a feature branch"   pass                        "wf ok.yml '      - run: git push origin HEAD:feature/x'"
expect_guard "workflow holds Cloudflare token"    "Cloudflare API token"      "wf s.yml '          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}'"
expect_guard "workflow runs wrangler deploy"      "Cloudflare API token"      "wf d.yml '      - run: npx wrangler@4 deploy'"
expect_guard "Cloudflare token with exemption"    pass                        "wf s.yml '# ship-gate-allow-cloudflare: R2 sync until Workers Builds can upload assets
          CLOUDFLARE_API_TOKEN: x'"
expect_guard "exemption without a real reason"    "Cloudflare API token"      "wf s.yml '# ship-gate-allow-cloudflare: tbd
          CLOUDFLARE_API_TOKEN: x'"
expect_guard "public Lighthouse storage"          "public storage"            "wf lh.yml '          temporaryPublicStorage: true'"
expect_guard "Renovate and Dependabot both (warn)" pass                       "echo '{}' > renovate.json && mkdir -p .github && echo 'version: 2' > .github/dependabot.yml"

echo "Config and contract (prepare.mjs)"
expect_prepare "conforming site passes"           pass ":"
expect_prepare "no lint script needed"            pass ":"
expect_prepare "missing check script"             "missing the \"check\" script" "sed -i 's/\"check\": \"astro check\", //' package.json"
expect_prepare "preview server needs preview"     "missing the \"preview\" script" "sed -i 's/\"preview\": \"astro preview\",//' package.json && cfg '\"server\":\"preview\"'"
expect_prepare "static server needs no preview"   pass                        "sed -i 's/\"preview\": \"astro preview\",//' package.json"
expect_prepare "missing @astrojs/check"           "Missing dev dependency @astrojs/check" "sed -i 's/\"@astrojs\/check\": \"1\"//' package.json"
expect_prepare "build script deploys"             "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& wrangler deploy\"/' package.json"
expect_prepare "siteUrl with trailing slash"      "siteUrl must be"           "sed -i 's#https://example.com#https://example.com/#' ship-gate.config.json"
expect_prepare "empty pages list"                 "pages must be"             "echo '{\"siteUrl\":\"https://example.com\",\"pages\":[]}' > ship-gate.config.json"
expect_prepare "site checks accepted"             pass                        "cfg '\"checks\":{\"preBuild\":[\"test\"],\"postBuild\":[\"check:canon\",\"migrate:local\"]}'"
expect_prepare "site check not a script"          "is not a script"           "cfg '\"checks\":{\"postBuild\":[\"check:nope\"]}'"
expect_prepare "site check touches production"    "touches production"        "cfg '\"checks\":{\"postBuild\":[\"migrate:remote\"]}'"
expect_prepare "site check deploys"               "touches production"        "cfg '\"checks\":{\"postBuild\":[\"deploy\"]}'"
expect_prepare "site check duplicates build"      "already runs"              "cfg '\"checks\":{\"preBuild\":[\"build\"]}'"
expect_prepare "unknown check phase"              "is not a phase"            "cfg '\"checks\":{\"after\":[\"test\"]}'"
expect_prepare "browser checks need Playwright"   "neither playwright"        "cfg '\"checks\":{\"browser\":[\"test\"]}'"
expect_prepare "python config accepted"           pass                        "cfg '\"python\":{\"version\":\"3.11\",\"packages\":[\"fonttools\",\"brotli==1.1.0\"]}'"
expect_prepare "python package name invalid"      "python.packages"           "cfg '\"python\":{\"version\":\"3.11\",\"packages\":[\"x; rm -rf /\"]}'"
expect_prepare "lighthouseUrls all accepted"      pass                        "cfg '\"lighthouseUrls\":\"all\"'"
expect_prepare "lighthouseUrls invalid"           "lighthouseUrls must be"    "cfg '\"lighthouseUrls\":\"some\"'"
expect_prepare "raise a threshold, no reason"     pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"categories:performance\",\"level\":\"error\"},{\"audit\":\"categories:accessibility\",\"minScore\":1}]'"
expect_prepare "loosen without reason"            "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "error to warn without reason"     "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"audit\":\"canonical\",\"level\":\"warn\"}]'"
expect_prepare "expired override"                 "override expired"          "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":0.9,\"reason\":\"Legacy embed pending replacement\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "override that changes nothing"    "changes nothing"           "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":0.95}]'"
expect_prepare "override on unknown audit"        "audit must be one of"      "cfg '\"thresholdOverrides\":[{\"audit\":\"robots-txt\",\"level\":\"warn\"}]'"
expect_prepare "valid loosening accepted"         pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"cumulative-layout-shift\",\"maxNumericValue\":0.1,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "old local kit copy present"       "local copy of the old ship-gate kit" "mkdir -p scripts && echo x > scripts/guards.sh"
expect_prepare "site's own Lighthouse config"     "Ship Gate runs Lighthouse now" "echo 'module.exports={}' > lighthouserc.cjs"
expect_prepare "missing config file"              "not found"                 "rm ship-gate.config.json"

echo "Lighthouse config and static server"
lh_case() {
  local name=$1 expect=$2 fragment=$3 d out; d="$(baseline)"; cd "$d" || return
  cfg "$fragment"
  mkdir -p dist/client/about dist/client/blog dist/server
  echo '<h1>home</h1>' > dist/client/index.html; echo a > dist/client/about/index.html
  echo p > dist/client/blog/post.html; echo nf > dist/client/404.html; echo s > dist/server/entry.html
  GITHUB_ENV= SHIP_GATE_DIR="$d/.sg" node "$PREPARE" lighthouse >/dev/null 2>&1
  out="$(node -e "const c=require('$d/.sg/lighthouserc.json').ci;const a=c.assert.assertions;
    console.log(c.collect.url.map(u=>u.replace('http://localhost:4321','')).join(' '),'|runs',c.collect.numberOfRuns,
    '|perf',JSON.stringify(a['categories:performance']),'|seo-category',a['categories:seo']===undefined?'absent':'present',
    '|upload',c.upload.target)" 2>&1)"
  if grep -qF -- "$expect" <<<"$out"; then ok "$name"; else bad "$name" "expected: $expect" "$out"; fi
  rm -rf "$d"
}
lh_case "all: every emitted page, not 404 or server" "/ /about/ /blog/post |runs 1" '"lighthouseUrls":"all"'
lh_case "listed pages: median of 3 runs"             "/ |runs 3"                     ''
lh_case "performance warns at 0.9 by default"         '|perf ["warn",{"minScore":0.9,"aggregationMethod":"median-run"}]' ''
lh_case "site can raise performance to error"         '|perf ["error",{"minScore":0.9' '"thresholdOverrides":[{"audit":"categories:performance","level":"error"}]'
lh_case "SEO category not asserted; reports private"  "|seo-category absent |upload filesystem" ''

serve_case() {
  local d port=4399 got; d="$(mktemp -d)"; mkdir -p "$d/dist/client/about"
  echo home > "$d/dist/client/index.html"; echo about > "$d/dist/client/about/index.html"
  echo gone > "$d/dist/client/404.html"; echo x > "$d/secret.txt"
  (cd "$d" && node "$HERE/serve-static.mjs" dist $port >/dev/null 2>&1 & echo $! > "$d/pid")
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 0.2; done
  got=""
  for p in / /about/ /about /nope /..%2fsecret.txt; do got="$got $p=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$p")"; done
  kill "$(cat "$d/pid")" 2>/dev/null
  if [ "$got" = " /=200 /about/=200 /about=200 /nope=404 /..%2fsecret.txt=404" ]; then ok "static server: routes, 404, no path escape"
  else bad "static server: routes, 404, no path escape" "unexpected codes" "$got"; fi
  rm -rf "$d"
}
serve_case

echo
echo "Self-test: $pass passed, $failn failed."
[ "$failn" -eq 0 ]
