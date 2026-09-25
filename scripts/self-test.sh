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
ALL_POLICIES="posthog-server-only tags-via-zaraz turnstile-forms workers-builds-only"

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
  out="$(SHIP_GATE_EXEMPT="${EXEMPT:-}" SHIP_GATE_POLICIES="${POLICIES-$ALL_POLICIES}" bash "$GUARDS" 2>&1)"; code=$?
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
  elif [[ "$expect" == warn:* ]]; then
    if [ "$code" -eq 0 ] && grep -F -- "${expect#warn:}" <<<"$out" | grep -q '::warning::'; then ok "$name"
    else bad "$name" "expected a pass with a warning containing: ${expect#warn:} (exit $code)" "$out"; fi
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
expect_guard "env file outside the site folder"   "Env/secret file committed" "echo 'A=1' > .dev.vars && mkdir site && cp .nvmrc site/ && cd site"
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
EXEMPT=cloudflare-in-workflows \
expect_guard "Cloudflare token under an exemption" pass                       "wf s.yml '          CLOUDFLARE_API_TOKEN: x'"
EXEMPT=push-to-main \
expect_guard "push to main is never exempt"       "pushes to main"            "wf auto.yml '      - run: git push origin HEAD:main'"
EXEMPT=posthog-key \
expect_guard "hard-coded key is never exempt"     "Hard-coded PostHog key"    "echo \"const k = '${PH}abcdefghijklmnopqrstuvwxyz0123'\" > src/lib/server/key.ts"
EXEMPT="posthog-client direct-tags" \
expect_guard "client PostHog + GTM under exemption" pass                     "sed -i 's/\"dependencies\": {/\"dependencies\": { \"posthog-js\": \"1\",/' package.json && echo '<script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-X\"></script>' > src/pages/gtm.astro"
expect_guard "HubSpot form embed allowed"        pass                          "echo '<script src=\"https://js-eu1.hsforms.net/forms/embed/1.js\"></script>' > src/pages/f.astro"
expect_guard "HubSpot embed, region variable"    pass                          "echo 'const s = \\\`https://js-\${region}.hsforms.net/forms/embed/1.js\\\`' > src/pages/f.ts"
expect_guard "inline GTM container id"            "Third-party tag"           "echo \"export const gtm = 'GTM-M7WZHXT7';\" > src/pages/site.ts"
expect_guard "public Lighthouse storage"          "public storage"            "wf lh.yml '          temporaryPublicStorage: true'"
POLICIES="" \
expect_guard "no policies: vendor choices are free" pass                        "sed -i 's/\"dependencies\": {/\"dependencies\": { \"posthog-js\": \"1\",/' package.json && echo '<script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-X\"></script>' > src/pages/gtm.astro && echo '<form method=\"post\"></form>' > src/pages/signup.astro && echo 'pages_build_output_dir = \"dist\"' > wrangler.toml && wf s.yml '          CLOUDFLARE_API_TOKEN: x'"
POLICIES="" \
expect_guard "no policies: env file still fails"  "Env/secret file committed" "echo 'A=1' > .env"
POLICIES="" \
expect_guard "no policies: push to main still fails" "pushes to main"         "wf auto.yml '      - run: git push origin HEAD:main'"
POLICIES="tags-via-zaraz" \
expect_guard "one policy on: only its guard runs" "Third-party tag"           "echo '<form method=\"post\"></form>' > src/pages/signup.astro && echo '<script src=\"https://www.clarity.ms/tag/abc\"></script>' > src/pages/c.astro"
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
expect_prepare "raise a threshold, no reason"     pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"categories:performance\",\"level\":\"error\"},{\"audit\":\"categories:best-practices\",\"minScore\":0.95}]'"
expect_prepare "loosen without reason"            "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "error to warn without reason"     "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"audit\":\"cumulative-layout-shift\",\"level\":\"warn\"}]'"
expect_prepare "v1 SEO override is a no-op"       pass                        "cfg '\"thresholdOverrides\":[{\"category\":\"seo\",\"minScore\":0.9,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "expired override"                 "expired on"          "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":0.9,\"reason\":\"Legacy embed pending replacement\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "override that changes nothing"    "changes nothing"           "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":1}]'"
expect_prepare "override on unknown audit"        "audit must be one of"      "cfg '\"thresholdOverrides\":[{\"audit\":\"robots-txt\",\"level\":\"warn\"}]'"
expect_prepare "valid loosening accepted"         pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"cumulative-layout-shift\",\"maxNumericValue\":0.1,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "guard exemption accepted"         pass                        "cfg '\"policies\":[\"posthog-server-only\",\"tags-via-zaraz\"],\"guardExemptions\":[{\"guard\":\"posthog-client\",\"reason\":\"Moving analytics server-side in PR 12\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "guard exemption expired"          "expired on"                "cfg '\"policies\":[\"posthog-server-only\",\"tags-via-zaraz\"],\"guardExemptions\":[{\"guard\":\"direct-tags\",\"reason\":\"GTM moves to Zaraz next sprint\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "guard exemption without reason"   "needs a real reason"       "cfg '\"policies\":[\"posthog-server-only\",\"tags-via-zaraz\"],\"guardExemptions\":[{\"guard\":\"direct-tags\",\"reason\":\"later\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "push to main cannot be exempted"  "can never be exempted"     "cfg '\"guardExemptions\":[{\"guard\":\"push-to-main\",\"reason\":\"Episode sync commits nightly\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "unknown guard exemption"          "guard must be one of"      "cfg '\"guardExemptions\":[{\"guard\":\"everything\",\"reason\":\"Just this once please\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "exemption for a policy not in use" "changes nothing"          "cfg '\"guardExemptions\":[{\"guard\":\"direct-tags\",\"reason\":\"GTM moves to Zaraz next sprint\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "core guard exempt without policy" pass                        "cfg '\"guardExemptions\":[{\"guard\":\"node-pin\",\"reason\":\"Upgrading Node with Astro next sprint\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "all four policies accepted"       pass                        "cfg '\"policies\":[\"posthog-server-only\",\"tags-via-zaraz\",\"turnstile-forms\",\"workers-builds-only\"]'"
expect_prepare "unknown policy"                   "policies must be a list"   "cfg '\"policies\":[\"house-style\"]'"
expect_prepare "discovery: raise a warning"       pass                        "cfg '\"discoveryOverrides\":[{\"rule\":\"llms-txt\",\"level\":\"error\"}]'"
expect_prepare "discovery: lower without reason"  "needs a real reason"       "cfg '\"discoveryOverrides\":[{\"rule\":\"open-graph\",\"level\":\"warn\"}]'"
expect_prepare "discovery: lower with reason"     pass                        "cfg '\"discoveryOverrides\":[{\"rule\":\"open-graph\",\"level\":\"off\",\"reason\":\"Social images ship with the redesign\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "discovery: lowering expired"      "expired on"                "cfg '\"discoveryOverrides\":[{\"rule\":\"open-graph\",\"level\":\"warn\",\"reason\":\"Social images ship with the redesign\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "discovery: changes nothing"       "changes nothing"           "cfg '\"discoveryOverrides\":[{\"rule\":\"canonical\",\"level\":\"error\"}]'"
expect_prepare "discovery: unknown rule"          "rule must be one of"       "cfg '\"discoveryOverrides\":[{\"rule\":\"seo-score\",\"level\":\"warn\"}]'"
expect_prepare "discovery: bad sitemap path"      "discovery.sitemap"         "cfg '\"discovery\":{\"sitemap\":\"sitemap.xml\"}'"
expect_prepare "discovery: unknown setting"       "is not a setting"          "cfg '\"discovery\":{\"llms\":true}'"
expect_prepare "discovery: extra search crawlers"  pass                        "cfg '\"discovery\":{\"searchCrawlers\":[\"Baiduspider\",\"Yeti\",\"YandexBot\"]}'"
expect_prepare "discovery: crawler always checked" "is always checked"         "cfg '\"discovery\":{\"searchCrawlers\":[\"googlebot\"]}'"
expect_prepare "discovery: crawler token invalid"  "crawler tokens"            "cfg '\"discovery\":{\"searchCrawlers\":[\"Baidu spider\"]}'"
expect_prepare "market and consent policies"       pass                        "cfg '\"policies\":[\"market-cn\",\"rtl-logical-css\",\"consent-before-tracking\"],\"consentEssentialCookies\":[\"session\"]'"
expect_prepare "essential cookies without policy"  "warn:only the consent-before-tracking" "cfg '\"consentEssentialCookies\":[\"session\"]'"
expect_prepare "essential cookie name invalid"     "consentEssentialCookies must be" "cfg '\"policies\":[\"consent-before-tracking\"],\"consentEssentialCookies\":[\"a b\"]'"
expect_prepare "keyboard raised to error"          pass                        "cfg '\"keyboard\":\"error\"'"
expect_prepare "keyboard level invalid"            "keyboard must be"          "cfg '\"keyboard\":\"off\"'"
expect_prepare "blocked-in-cn exempt, no policy"   "changes nothing"           "cfg '\"guardExemptions\":[{\"guard\":\"blocked-in-cn\",\"reason\":\"Fonts self-hosted next sprint\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "check reaches deploy via npm run" "touches production"        "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"verify\": \"npm run check:canon \&\& npm run deploy\"/' package.json && cfg '\"checks\":{\"postBuild\":[\"verify\"]}'"
expect_prepare "check runs a file that deploys"   "touches production"        "mkdir -p scripts && echo \"execFileSync('npx', ['wrangler', 'r2', 'object', 'put'])\" > scripts/canon.mjs && cfg '\"checks\":{\"postBuild\":[\"check:canon\"]}'"
expect_prepare "check submits to IndexNow"        "touches production"        "mkdir -p scripts && echo \"fetch('https://api.indexnow.org/IndexNow')\" > scripts/canon.mjs && cfg '\"checks\":{\"postBuild\":[\"check:canon\"]}'"
expect_prepare "build script pushes to git"       "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& git push\"/' package.json"
expect_prepare "postbuild runs a file that pings"  "writes to production"      "mkdir -p scripts && echo \"fetch('https://api.indexnow.org/IndexNow')\" > scripts/ping.mjs && sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"postbuild\": \"node scripts\/ping.mjs\"/' package.json"
expect_prepare "pretest deploys"                  "writes to production"      "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"pretest\": \"wrangler deploy\"/' package.json"
expect_prepare "test script deploys"              "writes to production"      "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run \&\& npm run deploy\"/' package.json"
expect_prepare "postinstall migrates remote"      "writes to production"      "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"postinstall\": \"npm run migrate:remote\"/' package.json"
expect_prepare "pre-script of a called script"    "writes to production"      "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"lint\": \"npm run check:canon\", \"precheck:canon\": \"wrangler deploy\"/' package.json"
expect_prepare "run-s glob reaches a deploy"      "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"run-s build:*\", \"build:site\": \"astro build\", \"build:ship\": \"wrangler deploy\"/' package.json"
expect_prepare "npm-run-all reaches a deploy"     "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"npm-run-all -s build:site deploy\", \"build:site\": \"astro build\"/' package.json"
expect_prepare "pnpm run reaches a deploy"        "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& pnpm deploy\"/' package.json"
expect_prepare "build runs a shell file that deploys" "writes to production"  "mkdir -p scripts && printf '#!/bin/sh\nnpx wrangler deploy\n' > scripts/ship.sh && sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& bash scripts\/ship.sh\"/' package.json"
expect_prepare "bare shell file that deploys"     "writes to production"      "mkdir -p scripts && printf '#!/bin/sh\nnpx wrangler deploy\n' > scripts/ship.sh && sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& .\/scripts\/ship.sh\"/' package.json"
expect_prepare "harmless postbuild passes"        pass                        "mkdir -p scripts && echo 'console.log(1)' > scripts/post.mjs && sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"postbuild\": \"node scripts\/post.mjs \&\& run-s check:*\"/' package.json"
expect_prepare "blocked URLs must be patterns"    "lighthouseBlockedUrls must be" "cfg '\"lighthouseBlockedUrls\":[42]'"
expect_prepare "distDir with trailing slash"      pass                        "cfg '\"distDir\":\"dist/\"'"
expect_prepare "distDir outside the site"         "distDir must be"           "cfg '\"distDir\":\"../dist\"'"
expect_prepare "title band above 75"              "titleMax cannot be above 75" "cfg '\"structure\":{\"titleMax\":90}'"
expect_prepare "QD title and description bands"   pass                        "cfg '\"structure\":{\"titleMin\":45,\"titleMax\":60,\"descMin\":140,\"descMax\":160}'"
expect_prepare "security headers only added to"   "must keep"                 "cfg '\"securityHeaders\":[\"x-content-type-options\"]'"
expect_prepare "reflow widths must include 320"   "includes 320"              "cfg '\"reflowWidths\":[360,390]'"
expect_prepare "e2ePages all accepted"            pass                        "cfg '\"e2ePages\":\"all\"'"
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

# serve_case NAME "PATH=CODE[:HEADER]..." — the server answers as Cloudflare would.
serve_setup() {
  local d=$1; mkdir -p "$d/dist/client/about" "$d/dist/client/_astro"
  echo home > "$d/dist/client/index.html"; echo about > "$d/dist/client/about/index.html"
  echo post > "$d/dist/client/post.html"; echo gone > "$d/dist/client/404.html"; echo x > "$d/secret.txt"
  echo js > "$d/dist/client/_astro/app.js"; echo notes > "$d/dist/client/notes.md"
  printf '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n/about/\n  ! X-Frame-Options\n' > "$d/dist/client/_headers"
  printf '/old /about/ 301\n/blog/* /posts/:splat 308\n/team/:name /about/ 302\n/shop https://shop.example.com/ 302\n/alias /post 200\n' > "$d/dist/client/_redirects"
  printf 'notes.md\n' > "$d/dist/client/.assetsignore"
}
serve_case() {
  local name=$1 want=$2 d port got=""; d="$(mktemp -d)"; port=$((20000 + RANDOM % 20000))
  serve_setup "$d"
  (cd "$d" && node "$HERE/serve-static.mjs" dist $port >/dev/null 2>&1 & echo $! > "$d/pid")
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 0.2; done
  # item: PATH=CODE, optionally @header=value (compared without spaces) or @!header (must be absent)
  for item in $want; do
    local path=${item%%=*} rest=${item#*=} code hdr="" res got_code line
    code=${rest%%@*}; [ "$rest" != "$code" ] && hdr=${rest#*@}
    res="$(curl -s -o /dev/null -D - "http://localhost:$port$path" | tr -d '\r ' | tr 'A-Z' 'a-z')"
    line="$(head -1 <<<"$res")"; line=${line#http/1.1}; got_code=${line:0:3}
    [ "$got_code" = "$code" ] || { got="$got $path=$got_code(want $code)"; continue; }
    case "$hdr" in
      "") ;;
      !*) grep -q "^${hdr#!}:" <<<"$res" && got="$got $path has ${hdr#!}" ;;
      *) line="$(grep "^${hdr%%=*}:" <<<"$res")"; [ "$line" = "${hdr%%=*}:${hdr#*=}" ] || got="$got $path ${line:-no ${hdr%%=*}} (want ${hdr#*=})" ;;
    esac
  done
  kill "$(cat "$d/pid")" 2>/dev/null
  if [ -z "$got" ]; then ok "$name"; else bad "$name" "unexpected responses" "$got"; fi
  rm -rf "$d"
}
serve_case "static server: pages, trailing slash, 404, no path escape" \
  "/=200 /about/=200 /about=307@location=/about/ /post=200 /post.html=307@location=/post /about/index.html=307 /nope=404 /..%2fsecret.txt=404"
serve_case "static server: _headers applied, globs, ! removals" \
  "/=200@x-content-type-options=nosniff /_astro/app.js=200@cache-control=public,max-age=31536000,immutable /about/=200@!x-frame-options /=200@x-frame-options=deny"
serve_case "static server: _redirects static, splat, placeholder, external, rewrite" \
  "/old=301@location=/about/ /blog/a/b=308@location=/posts/a/b /team/sam=302@location=/about/ /shop=302@location=https://shop.example.com/ /alias=200"
serve_case "static server: control files and .assetsignore not served" \
  "/_headers=404 /_redirects=404 /.assetsignore=404 /notes.md=404"


echo "Post-build scans (check-structure.mjs, check-copy.mjs, check-dist.sh)"
# page PATH TITLE DESC [BODY] — a conforming page in the fixture build
page() {
  mkdir -p "dist/client$(dirname "$1")"
  printf '<!doctype html><html lang="en"><head><title>%s</title><meta name="description" content="%s"><link rel="canonical" href="https://example.com%s"></head><body><h1>%s</h1><h2>Section</h2>%s</body></html>' \
    "$2" "$3" "${1%index.html}" "$2" "${4:-<p>Text.</p>}" > "dist/client$1"
}
built() {
  page /index.html "Home of the example site" "The example site home page, for Ship Gate's self-test."
  page /about/index.html "About the example site" "Who runs the example site, for Ship Gate's self-test."
}
# built_case NAME EXPECT(pass|substring) SCRIPT SETUP [CONFIG-FRAGMENT]
built_case() {
  local name=$1 expect=$2 script=$3 setup=$4 d out code; d="$(baseline)"; cd "$d" || return
  cfg "${5:-}"; built; eval "$setup"
  out="$(GITHUB_ENV= SHIP_GATE_DIR="$d/.sg" node "$PREPARE" after-build 2>&1 &&
    case "$script" in *.sh) SHIP_GATE_DIR="$d/.sg" bash "$HERE/$script" 2>&1 ;; *) SHIP_GATE_DIR="$d/.sg" node "$HERE/$script" 2>&1 ;; esac)"; code=$?
  check "$name" "$expect" "$code" "$out"
  rm -rf "$d"
}
S=check-structure.mjs; C=check-copy.mjs
built_case "structure: conforming build passes"   pass                  $S ":"
built_case "structure: two h1"                    "2 <h1> elements"     $S "page /x.html 'Page x of the site' 'A page with two headings for the self-test run.' '<h1>again</h1>'"
built_case "structure: skipped heading level"     "from h2 to h4"       $S "page /x.html 'Page x of the site' 'A page that skips a heading level in the self-test.' '<h4>deep</h4>'"
built_case "structure: _blank without noopener"   "without rel=\"noopener\"" $S "page /x.html 'Page x of the site' 'A page with an unsafe external link in the self-test.' '<a href=\"https://a.example\" target=\"_blank\">a</a>'"
built_case "structure: _blank with noreferrer ok" pass                  $S "page /x.html 'Page x of the site' 'A page with a safe external link in the self-test run.' '<a href=\"https://a.example\" target=\"_blank\" rel=\"noreferrer\">a</a>'"
built_case "structure: title over the band"       "over 60"             $S "page /x.html 'A title for page x that runs well past the sixty character band' 'A page whose title is too long for the band.'" '"structure":{"titleMax":60}'
built_case "structure: description under band"    "under 140"           $S ":" '"structure":{"descMin":140}'
built_case "structure: duplicate title"           "share the title"     $S "page /x.html 'Home of the example site' 'A different description for the duplicate title case.'"
built_case "structure: missing description"       "no meta description" $S "page /x.html 'Page x of the site' ''"
built_case "structure: noindex page not scanned"  pass                  $S "page /draft.html 'Draft' '' '<h1>two</h1>' && sed -i 's#<head>#<head><meta name=\"robots\" content=\"noindex\">#' dist/client/draft.html"
built_case "structure: template token left"       "unrendered template" $S "echo 'Call {{ phone }} today' > dist/client/llms-full.txt"
built_case "structure: _headers typo"             "is not \"Name: value\"" $S "printf '/*\n  X-Frame-Options DENY\n' > dist/client/_headers"
built_case "structure: conflict in _redirects"    "merge-conflict"      $S "printf '<<<<<<< HEAD\n/a /b 301\n=======\n/a /c 301\n>>>>>>> x\n' > dist/client/_redirects"
built_case "structure: _redirects bad status"     "is not one of"       $S "printf '/a /b 399\n' > dist/client/_redirects"
built_case "structure: llms.txt dead link"        "does not emit"       $S "printf '# Site\n- [About](https://example.com/about/)\n- [Gone](/gone/)\n' > dist/client/llms.txt"
built_case "structure: zero pages is a failure"   "Zero pages scanned"  $S "rm -rf dist/client && mkdir -p dist/client && echo '<meta name=robots content=noindex>' > dist/client/index.html"
built_case "copy: bracket placeholder"            "[Client name]"       $C "page /x.html 'Page x of the site' 'A page with draft copy for the self-test run.' '<p>Hello [Client name].</p>'"
built_case "copy: TODO left in"                   "TODO:"               $C "page /x.html 'Page x of the site' 'A page with draft copy for the self-test run.' '<p>TODO: write this</p>'"
built_case "copy: citations and labels pass"      pass                  $C "page /x.html 'Page x of the site' 'A page with citations for the self-test run.' '<p>As shown [1], see the brochure [PDF] [sic].</p><pre>TODO: code sample</pre>'"
built_case "copy: allowlisted string"             pass                  $C "page /x.html 'Page x of the site' 'A page with an allowed bracket for the self-test.' '<p>Sign as [Your Name].</p>'" '"copyAllowlist":["[Your Name]"]'
built_case "copy: noindex draft not scanned"      pass                  $C "page /x.html 'Draft' 'Draft page' '<p>TODO: all of it</p>' && sed -i 's#<head>#<head><meta name=\"robots\" content=\"noindex\">#' dist/client/x.html"
M=check-market.mjs
CN='"policies":["market-cn"]'
GFONT='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'
built_case "market-cn: Google Fonts stylesheet"   "blocked in mainland China" $M "page /x.html 'Page x of the site' 'A page with a Google font for the self-test run.' '$GFONT'" "$CN"
built_case "market-cn: YouTube image in CSS"      "blocked in mainland China" $M "mkdir -p dist/client/_astro && echo '.hero{background:url(//i.ytimg.com/vi/x/0.jpg)}' > dist/client/_astro/a.css" "$CN"
built_case "market-cn: links and sameAs load nothing" pass                $M "page /x.html 'Page x of the site' 'A page with social links for the self-test run.' '<a href=\"https://www.youtube.com/@example\">YouTube</a><script type=\"application/ld+json\">{\"sameAs\":[\"https://x.com/example\"]}</script>'" "$CN"
built_case "market-cn: jsdelivr warns"            "warn:unreliable from mainland China" $M "page /x.html 'Page x of the site' 'A page with a public CDN script for the self-test.' '<script src=\"https://cdn.jsdelivr.net/npm/a@1/a.js\"></script>'" "$CN"
built_case "market-cn: exemption warns"           "warn:[exempt: blocked-in-cn]" $M "page /x.html 'Page x of the site' 'A page with a Google font for the self-test run.' '$GFONT'" "\"policies\":[\"market-cn\"],\"guardExemptions\":[{\"guard\":\"blocked-in-cn\",\"reason\":\"Fonts self-hosted next sprint\",\"restoreBy\":\"$FUTURE\"}]"
built_case "market-cn off: Google Fonts allowed"  pass                    $M "page /x.html 'Page x of the site' 'A page with a Google font for the self-test run.' '$GFONT'"
built_case "rtl-logical-css: physical CSS warns"  "warn:won't mirror under dir" $M "mkdir -p dist/client/_astro && echo '.a{margin-left:1rem;text-align:left}.b{left:0}' > dist/client/_astro/a.css" '"policies":["rtl-logical-css"]'
built_case "rtl-logical-css: logical CSS passes"  pass                    $M "mkdir -p dist/client/_astro && echo '.a{margin-inline-start:1rem;text-align:start}.b{inset-inline-start:0}' > dist/client/_astro/a.css" '"policies":["rtl-logical-css"]'
all_case() {
  local d out; d="$(baseline)"; cd "$d" || return
  cfg '"lighthouseUrls":"all","e2ePages":"all"'; built
  page /draft/index.html 'Draft' 'Draft' && sed -i 's#<head>#<head><meta name="robots" content="noindex,follow">#' dist/client/draft/index.html
  echo '<meta http-equiv="refresh" content="0;url=/about/">' > dist/client/old.html
  echo 'google-site-verification: google0123abcd.html' > dist/client/google0123abcd.html
  mkdir -p dist/client/server && page /server/index.html 'Server rack reviews' 'A content folder that happens to be named server.'
  mkdir -p dist/server && echo x > dist/server/entry.html
  GITHUB_ENV= SHIP_GATE_DIR="$d/.sg" node "$PREPARE" after-build >/dev/null 2>&1
  out="$(node -e "const r=require('$d/.sg/run.json'),c=require('$d/.sg/lighthouserc.json').ci;
    console.log(r.pages.join(' '),'|',c.collect.url.map(u=>u.replace('http://localhost:4321','')).join(' '))" 2>&1)"
  if [ "$out" = "/ /about/ /server/ | / /about/ /server/" ]; then ok "all: skips noindex, redirect stubs, verification files, root server/"
  else bad "all: skips noindex, redirect stubs, verification files, root server/" "got" "$out"; fi
  rm -rf "$d"
}
all_case
dist_case() {
  local name=$1 expect=$2 setup=$3 d out code; d="$(mktemp -d)"; cd "$d" || return
  mkdir -p dist/client/_astro dist/server; echo 'import "x"' > dist/client/_astro/a.js; echo 'posthog-node' > dist/server/entry.mjs
  eval "$setup"
  out="$(SHIP_GATE_DIST=dist/ SHIP_GATE_EXEMPT="${EXEMPT:-}" bash "$HERE/check-dist.sh" 2>&1)"; code=$?
  check "$name" "$expect" "$code" "$out"; rm -rf "$d"
}
dist_case "client bundle clean; server may use posthog" pass              "echo 'posthog.init(1)' > dist/server/x.js"
dist_case "client bundle ships posthog-js"          "PostHog found"       "echo 'import \"posthog-js\"' > dist/client/_astro/b.js"
EXEMPT=posthog-client \
dist_case "posthog-js under exemption warns"        pass                  "echo 'import \"posthog-js\"' > dist/client/_astro/b.js"
EXEMPT=posthog-client \
dist_case "key in client output never exempt"       "PostHog key found"   "echo \"k='${PH}abcdefghijklmnopqrstuvwxyz0123'\" > dist/client/_astro/b.js"

echo "Discovery scan (check-discovery.mjs): SEO, AEO, GEO, AIO"
WORDS="This page exists so the discovery scan has real text to read: enough words that a crawler which does not run JavaScript still finds the substance of the page in its HTML, which is what search engines, answer engines and AI assistants index, quote and cite when they send people here."
ORG='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","url":"https://example.com/","sameAs":["https://www.linkedin.com/company/example"]}</script>'
# dpage FILE TITLE — a page that passes every discovery rule
dpage() {
  local url="${1%index.html}"; url="${url%.html}"
  mkdir -p "dist/client$(dirname "$1")"
  printf '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>%s</title><meta name="description" content="About %s."><link rel="canonical" href="https://example.com%s"><meta property="og:title" content="%s"><meta property="og:description" content="About %s."><meta property="og:image" content="https://example.com/og.png"></head><body><h1>%s</h1><p>%s</p><a href="/">Home</a> <a href="/about/">About</a></body></html>' \
    "$2" "$2" "$url" "$2" "$2" "$2" "$WORDS" > "dist/client$1"
}
# inject FILE BEFORE HTML — insert HTML before the first BEFORE
inject() { node -e 'const fs=require("fs");const [f,w,h]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(w,h+w))' "$@"; }
sitemap() { { echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  for u in "$@"; do echo "<url><loc>https://example.com$u</loc><lastmod>2026-09-01</lastmod></url>"; done; echo '</urlset>'; } > dist/client/sitemap.xml; }
discovered() {
  dpage /index.html "Home"; dpage /about/index.html "About"
  inject dist/client/index.html '</head>' "$ORG"
  echo png > dist/client/og.png
  printf 'User-agent: *\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt
  printf '/\n  Link: </llms.txt>; rel="describedby"; type="text/markdown"\n' > dist/client/_headers
  sitemap / /about/
  printf '# Example\n\n> The example site.\n\n- [About](/about/)\n' > dist/client/llms.txt
}
# disco_case NAME EXPECT(pass|warn:substring|substring) SETUP [CONFIG-FRAGMENT]
disco_case() {
  local name=$1 expect=$2 setup=$3 d out code; d="$(baseline)"; cd "$d" || return
  cfg "${4:-}"; discovered; eval "$setup"
  out="$(GITHUB_ENV= GITHUB_STEP_SUMMARY= SHIP_GATE_DIR="$d/.sg" node "$PREPARE" after-build 2>&1 &&
    SHIP_GATE_DIR="$d/.sg" node "$HERE/check-discovery.mjs" 2>&1)"; code=$?
  if [ "$expect" = pass ] && grep -q '::warning::' <<<"$out"; then bad "$name" "expected a clean pass, got warnings" "$out"
  else check "$name" "$expect" "$code" "$out"; fi
  rm -rf "$d"
}
disco_case "conforming build passes, no warnings" pass ":"
disco_case "specific business type as site owner" pass                         "sed -i 's#\"@type\":\"Organization\",\"name\":\"Example\"#\"@type\":\"Hotel\",\"name\":\"Example\",\"address\":\"1 Main St\"#' dist/client/index.html"
disco_case "Dentist as site owner"                 pass                         "sed -i 's#\"@type\":\"Organization\",\"name\":\"Example\"#\"@type\":\"Dentist\",\"name\":\"Example\",\"address\":\"1 Main St\"#' dist/client/index.html"
disco_case "business subtype still needs address" "missing address"             "sed -i 's#\"@type\":\"Organization\"#\"@type\":\"Plumber\"#' dist/client/index.html"
disco_case "robots.txt missing"                  "robots.txt: not in the build"   "rm dist/client/robots.txt"
disco_case "robots.txt without Sitemap"          "no \"Sitemap:\" line"           "printf 'User-agent: *\nAllow: /\n' > dist/client/robots.txt"
disco_case "robots.txt Sitemap off-site"         "is not an absolute URL on"      "printf 'User-agent: *\nAllow: /\nSitemap: https://cdn.example.net/sitemap.xml\n' > dist/client/robots.txt"
disco_case "robots.txt blocks everything"        "blocks Googlebot"               "printf 'User-agent: *\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "robots.txt blocks one page for Bing" "blocks Bingbot"                 "printf 'User-agent: bingbot\nDisallow: /about/\n\nUser-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "longest match: Allow beats Disallow" pass                             "printf 'User-agent: *\nContent-Signal: search=yes\nDisallow: /\nAllow: /$\nAllow: /about/\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "AI search crawler blocked"           "blocks OAI-SearchBot"           "printf 'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "AI user-fetch crawler blocked"       "blocks Claude-User"             "printf 'User-agent: Claude-User\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "only training crawlers blocked"      pass                             "printf 'User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "robots.txt without User-agent"        "has no \"User-agent:\" line"   "printf 'Content-Signal: search=yes\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "no AI crawler group (warn)"          "warn:names no AI crawler"       "printf 'User-agent: *\nContent-Signal: search=yes\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "no Content-Signal (warn)"            "warn:no \"Content-Signal:\" line" "sed -i '/Content-Signal/d' dist/client/robots.txt"
disco_case "Content-Signal unknown key"          "\"ai_train\" is not"            "sed -i 's#ai-train=no#ai_train=no#' dist/client/robots.txt"
disco_case "Content-Signal bad value"            "\"ai-train=maybe\" is not"      "sed -i 's#ai-train=no#ai-train=maybe#' dist/client/robots.txt"
disco_case "Content-Signal outside a group"      "before any User-agent line"     "sed -i '1i Content-Signal: search=yes' dist/client/robots.txt"
disco_case "no /sitemap.xml (warn)"              "warn:/sitemap.xml: not in the build" "mv dist/client/sitemap.xml dist/client/sitemap-index.xml && sed -i 's#sitemap.xml#sitemap-index.xml#' dist/client/robots.txt"
disco_case "/sitemap.xml redirects"              pass                             "mv dist/client/sitemap.xml dist/client/sitemap-index.xml && sed -i 's#sitemap.xml#sitemap-index.xml#' dist/client/robots.txt && printf '/sitemap.xml /sitemap-index.xml 301\n' > dist/client/_redirects"
disco_case "no Link header (warn)"               "warn:no Link header"            "rm dist/client/_headers"
disco_case "Link header from a /* rule"          pass                             "printf '/*\n  Link: </.well-known/api-catalog>; rel=\"api-catalog\"\n' > dist/client/_headers && mkdir -p dist/client/.well-known && echo '{}' > dist/client/.well-known/api-catalog"
disco_case "Link without an agent rel (warn)"    "warn:has no rel of"             "sed -i 's#describedby#bogus#' dist/client/_headers"
disco_case "Link target not built (warn)"        "warn:is not in the build"       "rm dist/client/llms.txt" '"discoveryOverrides":[{"rule":"llms-txt","level":"off","reason":"llms.txt waits on the content audit","restoreBy":"'"$FUTURE"'"}]'
disco_case "Link malformed (warn)"               "warn:does not start with <URI>" "printf '/\n  Link: /llms.txt; rel=describedby\n' > dist/client/_headers"
disco_case "no sitemap"                          "no sitemap found"               "rm dist/client/sitemap.xml && printf 'User-agent: *\nAllow: /\n' > dist/client/robots.txt"
disco_case "sitemap index with a child sitemap"  pass                             "mv dist/client/sitemap.xml dist/client/sitemap-0.xml && printf '<sitemapindex><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>' > dist/client/sitemap-index.xml && sed -i 's#sitemap.xml#sitemap-index.xml#' dist/client/robots.txt && printf '/sitemap.xml /sitemap-index.xml 301\n' > dist/client/_redirects"
disco_case "sitemap child missing"               "not in the build"               "printf '<sitemapindex><sitemap><loc>https://example.com/sitemap-9.xml</loc></sitemap></sitemapindex>' > dist/client/sitemap.xml"
disco_case "sitemap misses a page"               "indexable, but not in the sitemap" "sitemap /"
disco_case "sitemap lists a redirecting URL"     "that URL redirects"             "sitemap / /about/ /about"
disco_case "sitemap lists a noindex page"        "the page is noindex"            "dpage /draft/index.html Draft && inject dist/client/draft/index.html '</head>' '<meta name=\"robots\" content=\"noindex\">' && sitemap / /about/ /draft/"
disco_case "sitemap lists a missing page"        "the build does not emit it"     "sitemap / /about/ /gone/"
disco_case "sitemap URL off-site"                "is not on https://example.com"  "sed -i 's#https://example.com/about/#https://www.example.com/about/#' dist/client/sitemap.xml"
disco_case "sitemap lastmod not a date"          "is not a W3C date"              "sed -i 's#2026-09-01#1 Sept 2026#' dist/client/sitemap.xml"
disco_case "sitemap without lastmod (warn)"      "warn:without lastmod"           "sed -i 's#<lastmod>2026-09-01</lastmod>##g' dist/client/sitemap.xml"
disco_case "canonical missing"                   "0 canonical links"              "sed -i 's#<link rel=\"canonical\"[^>]*>##' dist/client/about/index.html"
disco_case "canonical off-site"                  "not an absolute URL on"         "sed -i 's#canonical\" href=\"https://example.com#canonical\" href=\"https://staging.example.com#' dist/client/about/index.html"
disco_case "canonical to a redirecting URL"      "is not an indexable page"       "sed -i 's#canonical\" href=\"https://example.com/about/#canonical\" href=\"https://example.com/about#' dist/client/about/index.html"
disco_case "canonicalised page left in sitemap"  "its canonical is /"             "sed -i 's#canonical\" href=\"https://example.com/about/#canonical\" href=\"https://example.com/#' dist/client/about/index.html"
disco_case "canonicalised page out of sitemap"   pass                             "sed -i 's#canonical\" href=\"https://example.com/about/#canonical\" href=\"https://example.com/#' dist/client/about/index.html && sitemap /"
disco_case "no html lang"                        "no lang attribute"              "sed -i 's#<html lang=\"en\">#<html>#' dist/client/about/index.html"
disco_case "no viewport"                         "name=\"viewport\""              "sed -i 's#<meta name=\"viewport\"[^>]*>##' dist/client/about/index.html"
disco_case "broken internal link"                "does not emit: /missing/"       "inject dist/client/about/index.html '</body>' '<a href=\"/missing/\">x</a>'"
disco_case "relative and absolute links resolve" pass                             "inject dist/client/about/index.html '</body>' '<a href=\"../\">up</a><a href=\"https://example.com/about/#team\">team</a><a href=\"/about\">slashless</a><a href=\"/og.png?v=2\">img</a><a href=\"https://other.example/\">out</a><a href=\"mailto:a@example.com\">mail</a>'"
disco_case "link covered by _redirects"          pass                             "inject dist/client/about/index.html '</body>' '<a href=\"/old/page\">old</a>' && printf '/old/* /about/ 301\n' > dist/client/_redirects"
disco_case "link under ignoreLinks"              pass                             "inject dist/client/about/index.html '</body>' '<a href=\"/api/logout\">x</a>'" '"discovery":{"ignoreLinks":["/api/"]}'
disco_case "og:image missing"                    "missing og:image"               "sed -i 's#<meta property=\"og:image\"[^>]*>##' dist/client/about/index.html"
disco_case "og:image relative"                   "must be an absolute URL"        "sed -i 's#og:image\" content=\"https://example.com/og.png#og:image\" content=\"/og.png#' dist/client/about/index.html"
disco_case "og:image not in the build"           "is not in the build"            "rm dist/client/og.png"
disco_case "JSON-LD invalid"                     "is not valid JSON"              "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@type\":}</script>'"
disco_case "JSON-LD without schema.org context"  "no schema.org @context"         "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@type\":\"WebPage\"}</script>'"
disco_case "Article missing datePublished"       "missing datePublished"          "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"BlogPosting\",\"headline\":\"About\",\"author\":{\"@type\":\"Person\",\"name\":\"Sam\"},\"dateModified\":\"2026-09-01\"}</script>'"
disco_case "Article without dateModified (warn)" "warn:no dateModified"          "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"Article\",\"headline\":\"About\",\"author\":{\"@type\":\"Person\",\"name\":\"Sam\"},\"datePublished\":\"2026-09-01\"}</script>'"
disco_case "@graph nodes share the context"      pass                             "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@graph\":[{\"@type\":\"WebSite\",\"name\":\"Example\",\"url\":\"https://example.com/\"},{\"@type\":\"WebPage\",\"name\":\"About\"}]}</script>'"
FAQ='<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How long does setup take?","acceptedAnswer":{"@type":"Answer","text":"About a week."}}]}</script>'
disco_case "FAQ question not on the page"        "not on the page"                "inject dist/client/about/index.html '</head>' '$FAQ'"
disco_case "FAQ question on the page"            pass                             "inject dist/client/about/index.html '</head>' '$FAQ' && inject dist/client/about/index.html '</body>' '<h2>How long does setup take&#x3F;</h2><p>About a week.</p>'"
disco_case "FAQ answer missing"                  "acceptedAnswer.text"            "inject dist/client/about/index.html '</head>' '<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"FAQPage\",\"mainEntity\":[{\"@type\":\"Question\",\"name\":\"Why?\"}]}</script>'"
disco_case "home without site entity"            "no Organization"                "sed -i 's#<script type=\"application/ld+json\">.*</script>##' dist/client/index.html"
disco_case "LocalBusiness needs an address"      "missing address"                "sed -i 's#\"@type\":\"Organization\"#\"@type\":\"LocalBusiness\"#' dist/client/index.html"
disco_case "site entity url off-site"            "url must be on"                 "sed -i 's#\"url\":\"https://example.com/\"#\"url\":\"https://example.org/\"#' dist/client/index.html"
disco_case "site entity without sameAs (warn)"   "warn:no sameAs"                 "sed -i 's#,\"sameAs\":\[[^]]*\]##' dist/client/index.html"
disco_case "nested page without breadcrumbs (warn)" "warn:BreadcrumbList"         "dpage /guides/setup/index.html Setup && sitemap / /about/ /guides/setup/"
disco_case "thin page (warn)"                    "warn:words of text"             "sed -i \"s#\$WORDS#Short.#\" dist/client/about/index.html"
disco_case "nosnippet (warn)"                    "warn:stops Google quoting"      "inject dist/client/about/index.html '</head>' '<meta name=\"robots\" content=\"index, nosnippet\">'"
disco_case "max-image-preview:none (warn)"       "warn:hides the page"            "inject dist/client/about/index.html '</head>' '<meta name=\"googlebot\" content=\"max-image-preview:none\">'"
disco_case "no llms.txt (warn)"                  "warn:llms.txt: not in the build" "rm dist/client/llms.txt"
disco_case "llms.txt malformed"                  "must start with"                "printf 'Example site\n- [About](/about/)\n' > dist/client/llms.txt"
ROBOTS_BAIDU="printf 'User-agent: Baiduspider\nDisallow: /\n\nUser-agent: *\nContent-Signal: search=yes\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n' > dist/client/robots.txt"
disco_case "extra crawler blocked when listed"   "blocks Baiduspider"             "$ROBOTS_BAIDU" '"discovery":{"searchCrawlers":["Baiduspider"]}'
disco_case "extra crawler not listed: unchecked" pass                             "$ROBOTS_BAIDU"
disco_case "302 redirect (warn)"                 "warn:a temporary move"          "printf '/old /about/ 302\n' > dist/client/_redirects"
disco_case "redirect with no status (warn)"      "warn:default when no status"    "printf '/old /about/\n' > dist/client/_redirects"
disco_case "301, 308 and rewrites pass"          pass                             "printf '/old /about/ 301\n/new /about/ 308\n/alias /about/ 200\n' > dist/client/_redirects"
RTL="dpage /ar/index.html Arabic && sed -i 's#<html lang=\"en\">#<html lang=\"ar\">#' dist/client/ar/index.html && sitemap / /about/ /ar/"
RTLDIR="$RTL && sed -i 's#<html lang=\"ar\">#<html lang=\"ar\" dir=\"rtl\">#' dist/client/ar/index.html"
disco_case "RTL page without dir"                "has no dir=\"rtl\""             "$RTL"
disco_case "RTL page with dir on html"           pass                             "$RTLDIR"
disco_case "RTL region subtag, dir on body"      pass                             "$RTL && sed -i 's#<html lang=\"ar\">#<html lang=\"ar-AE\">#; s#<body>#<body dir=\"rtl\">#' dist/client/ar/index.html"
HL_EN='<link rel="alternate" hreflang="en" href="https://example.com/"><link rel="alternate" hreflang="ar" href="https://example.com/ar/">'
disco_case "hreflang pair links both ways"       pass                             "$RTLDIR && inject dist/client/index.html '</head>' '$HL_EN' && inject dist/client/ar/index.html '</head>' '$HL_EN'"
disco_case "hreflang one way (warn)"             "warn:has no hreflang link back" "$RTLDIR && inject dist/client/index.html '</head>' '$HL_EN'"
disco_case "hreflang to a missing page (warn)"   "warn:not an indexable page"     "inject dist/client/index.html '</head>' '<link rel=\"alternate\" hreflang=\"fr\" href=\"https://example.com/fr/\">'"
disco_case "Markdown mirror indexable (warn)"    "warn:can be indexed as duplicates" "echo '# About' > dist/client/about.md && printf '# Example\n\n> The example site.\n\n- [About](/about.md)\n' > dist/client/llms.txt"
disco_case "Markdown mirror sends noindex"       pass                             "echo '# About' > dist/client/about.md && printf '# Example\n\n> The example site.\n\n- [About](https://example.com/about.md)\n' > dist/client/llms.txt && printf '/*.md\n  X-Robots-Tag: noindex\n' >> dist/client/_headers"
disco_case "rule lowered with a reason"          "warn:0 canonical links"         "sed -i 's#<link rel=\"canonical\"[^>]*>##' dist/client/about/index.html" "\"discoveryOverrides\":[{\"rule\":\"canonical\",\"level\":\"warn\",\"reason\":\"Canonicals ship with the new layout\",\"restoreBy\":\"$FUTURE\"}]"
disco_case "warning raised to error"             "llms.txt: not in the build"     "rm dist/client/llms.txt" '"discoveryOverrides":[{"rule":"llms-txt","level":"error"}]'
disco_case "rule turned off (warns it is lowered)" "warn:lowered to off"          "rm dist/client/llms.txt" "\"discoveryOverrides\":[{\"rule\":\"llms-txt\",\"level\":\"off\",\"reason\":\"llms.txt waits on the content audit\",\"restoreBy\":\"$FUTURE\"}]"

echo "Post-deploy live checks (check-live.mjs)"
# live_case NAME EXPECT(pass|warn:substring|substring) OVERRIDES-JSON [LEVELS-JSON]
# A stand-in production: a conforming site unless OVERRIDES replaces a path's
# { status, type, body, link } (the "md" key answers Accept: text/markdown on /).
LIVE_SERVER='
const http = require("http");
const good = {
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: SITE/sitemap.xml\n" },
  "/sitemap.xml": { type: "application/xml", body: "<urlset><url><loc>SITE/</loc></url></urlset>" },
  "/": { type: "text/html; charset=utf-8", body: "<!doctype html><h1>Home</h1>", link: "</llms.txt>; rel=\"describedby\"" },
  md: { type: "text/markdown; charset=utf-8", body: "# Home\n" },
};
const routes = { ...good, ...JSON.parse(process.env.OVERRIDES) };
const srv = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  const md = path === "/" && /text\/markdown/.test(req.headers.accept || "");
  const r = routes[md ? "md" : path];
  if (!r) { res.writeHead(404); return res.end(); }
  const site = "http://127.0.0.1:" + srv.address().port;
  res.writeHead(r.status || 200, { "content-type": r.type || "", ...(r.link ? { link: r.link } : {}) });
  res.end((r.body || "").replaceAll("SITE", site));
});
srv.listen(0, "127.0.0.1", () => console.log(srv.address().port));
'
live_case() {
  local name=$1 expect=$2 port pid out code
  exec 3< <(OVERRIDES="$3" node -e "$LIVE_SERVER")
  pid=$!; read -r port <&3
  out="$(SHIP_GATE_SITE_URL="http://127.0.0.1:$port" SHIP_GATE_SMOKE_PATHS="/ /robots.txt" SHIP_GATE_DISCOVERY_LEVELS="${4:-}" \
    node "$HERE/check-live.mjs" 2>&1)"; code=$?
  kill "$pid" 2>/dev/null; exec 3<&-
  if [ "$expect" = pass ] && grep -q '::warning::' <<<"$out"; then bad "$name" "expected a clean pass, got warnings" "$out"
  else check "$name" "$expect" "$code" "$out"; fi
}
live_case "production conforms"                  pass                           '{}'
live_case "robots.txt served as HTML"            "expects text/plain"           '{"/robots.txt":{"type":"text/html","body":"User-agent: *\nAllow: /\n"}}'
live_case "robots.txt without User-agent"        "no \"User-agent:\" line"      '{"/robots.txt":{"type":"text/plain","body":"Sitemap: SITE/sitemap.xml\n"}}'
live_case "robots.txt answers 500"               "answered 500"                 '{"/robots.txt":{"status":500}}'
live_case "robots.txt blocks an AI search bot"   "blocks PerplexityBot"         '{"/robots.txt":{"type":"text/plain","body":"User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n"}}'
live_case "sitemap in robots.txt is 404"         "answered 404"                 '{"/sitemap.xml":{"status":404}}'
live_case "sitemap served as HTML"               "not XML"                      '{"/sitemap.xml":{"type":"text/html","body":"<urlset></urlset>"}}'
live_case "no Link header (warn)"                "warn:sends no Link header"    '{"/":{"type":"text/html","body":"<h1>Home</h1>"}}'
live_case "no Markdown negotiation (warn)"       "warn:got \"text/html\""       '{"md":{"type":"text/html","body":"<h1>Home</h1>"}}'
live_case "Markdown turned off by override"      pass                           '{"md":{"type":"text/html","body":"<h1>Home</h1>"}}' '{"markdown-negotiation":"off"}'
live_case "Markdown raised to error"             "got \"text/html\""            '{"md":{"type":"text/html","body":"<h1>Home</h1>"}}' '{"markdown-negotiation":"error"}'
d="$(baseline)"; cd "$d" && cfg '"discoveryOverrides":[{"rule":"markdown-negotiation","level":"error"}]' && : > "$d/env"
out="$(GITHUB_ENV="$d/env" node "$PREPARE" post-deploy 2>&1)"; code=$?
check "post-deploy exports discovery levels" pass "$code" "$out"
if grep -q '^SHIP_GATE_DISCOVERY_LEVELS=.*"markdown-negotiation":"error"' "$d/env"; then ok "post-deploy levels carry the override"
else bad "post-deploy levels carry the override" "SHIP_GATE_DISCOVERY_LEVELS missing or wrong" "$(cat "$d/env")"; fi
cd / && rm -rf "$d"

echo "Release (release.sh)"
# rel_case NAME EXPECT(pass|substring) CHANGELOG-TEXT — a dry run, so nothing is published
rel_case() {
  local name=$1 expect=$2 d out code; d="$(mktemp -d)"
  printf '%b' "$3" > "$d/CHANGELOG.md"
  out="$(CHANGELOG="$d/CHANGELOG.md" DRY_RUN=1 bash "$HERE/release.sh" 2>&1)"; code=$?
  if [ "$expect" = pass ] || [ "$code" -ne 0 ]; then check "$name" "$expect" "$code" "$out"
  elif [[ "$expect" == !* ]]; then
    if grep -qF -- "${expect#!}" <<<"$out"; then bad "$name" "output must not contain: ${expect#!}" "$out"; else ok "$name"; fi
  elif grep -qF -- "$expect" <<<"$out"; then ok "$name"; else bad "$name" "expected output containing: $expect" "$out"; fi
  rm -rf "$d"
}
REL_TWO='# Changelog\n\n## v1.2.0 — 2026-10-01\n\n- new\n\n## v1.1.0 — 2026-09-01\n\n- old\n'
rel_case "newest version is the one released"    "version=v1.2.0"        "$REL_TWO"
rel_case "its notes are included"                "- new"                 "$REL_TWO"
rel_case "older versions' notes are not"         "!- old"                "$REL_TWO"
rel_case "not-released heading publishes nothing" "marked not released"   '# Changelog\n\n## v1.0.0 — 2026-09-24 (not released)\n\n- draft\n'
rel_case "no version heading fails"              "No \"## vX.Y.Z\" heading" '# Changelog\n\n## Unreleased\n\n- next\n'
rel_case "version without notes fails"           "has no notes"          '# Changelog\n\n## v1.2.0 — 2026-10-01\n\n## v1.1.0\n\n- old\n'
rel_case "this repo's CHANGELOG has a release"   "version=v"             "$(sed 's/\\/\\\\/g' "$HERE/../CHANGELOG.md")"
echo
echo "Self-test: $pass passed, $failn failed."
[ "$failn" -eq 0 ]
