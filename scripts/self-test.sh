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
  out="$(SHIP_GATE_EXEMPT="${EXEMPT:-}" bash "$GUARDS" 2>&1)"; code=$?
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
EXEMPT=cloudflare-in-workflows \
expect_guard "Cloudflare token under an exemption" pass                       "wf s.yml '          CLOUDFLARE_API_TOKEN: x'"
EXEMPT=push-to-main \
expect_guard "push to main is never exempt"       "pushes to main"            "wf auto.yml '      - run: git push origin HEAD:main'"
EXEMPT=posthog-key \
expect_guard "hard-coded key is never exempt"     "Hard-coded PostHog key"    "echo \"const k = '${PH}abcdefghijklmnopqrstuvwxyz0123'\" > src/lib/server/key.ts"
EXEMPT="posthog-client direct-tags" \
expect_guard "client PostHog + GTM under exemption" pass                     "sed -i 's/\"dependencies\": {/\"dependencies\": { \"posthog-js\": \"1\",/' package.json && echo '<script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-X\"></script>' > src/pages/gtm.astro"
expect_guard "HubSpot form embed loaded directly" "Third-party tag"           "echo '<script src=\"https://js-eu1.hsforms.net/forms/embed/1.js\"></script>' > src/pages/f.astro"
expect_guard "HubSpot embed with region variable" "Third-party tag"           "echo 'const s = \\\`https://js-\${region}.hsforms.net/forms/embed/1.js\\\`' > src/pages/f.ts"
expect_guard "inline GTM container id"            "Third-party tag"           "echo \"export const gtm = 'GTM-M7WZHXT7';\" > src/pages/site.ts"
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
expect_prepare "raise a threshold, no reason"     pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"categories:performance\",\"level\":\"error\"},{\"audit\":\"categories:best-practices\",\"minScore\":0.95}]'"
expect_prepare "loosen without reason"            "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "error to warn without reason"     "needs a real reason"       "cfg '\"thresholdOverrides\":[{\"audit\":\"cumulative-layout-shift\",\"level\":\"warn\"}]'"
expect_prepare "v1 SEO override is a no-op"       pass                        "cfg '\"thresholdOverrides\":[{\"category\":\"seo\",\"minScore\":0.9,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "expired override"                 "expired on"          "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":0.9,\"reason\":\"Legacy embed pending replacement\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "override that changes nothing"    "changes nothing"           "cfg '\"thresholdOverrides\":[{\"category\":\"accessibility\",\"minScore\":1}]'"
expect_prepare "override on unknown audit"        "audit must be one of"      "cfg '\"thresholdOverrides\":[{\"audit\":\"robots-txt\",\"level\":\"warn\"}]'"
expect_prepare "valid loosening accepted"         pass                        "cfg '\"thresholdOverrides\":[{\"audit\":\"cumulative-layout-shift\",\"maxNumericValue\":0.1,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "guard exemption accepted"         pass                        "cfg '\"guardExemptions\":[{\"guard\":\"posthog-client\",\"reason\":\"Moving analytics server-side in PR 12\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "guard exemption expired"          "expired on"                "cfg '\"guardExemptions\":[{\"guard\":\"direct-tags\",\"reason\":\"GTM moves to Zaraz next sprint\",\"restoreBy\":\"$PAST\"}]'"
expect_prepare "guard exemption without reason"   "needs a real reason"       "cfg '\"guardExemptions\":[{\"guard\":\"direct-tags\",\"reason\":\"later\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "push to main cannot be exempted"  "can never be exempted"     "cfg '\"guardExemptions\":[{\"guard\":\"push-to-main\",\"reason\":\"Episode sync commits nightly\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "unknown guard exemption"          "guard must be one of"      "cfg '\"guardExemptions\":[{\"guard\":\"everything\",\"reason\":\"Just this once please\",\"restoreBy\":\"$FUTURE\"}]'"
expect_prepare "check reaches deploy via npm run" "touches production"        "sed -i 's/\"test\": \"vitest run\"/\"test\": \"vitest run\", \"verify\": \"npm run check:canon \&\& npm run deploy\"/' package.json && cfg '\"checks\":{\"postBuild\":[\"verify\"]}'"
expect_prepare "check runs a file that deploys"   "touches production"        "mkdir -p scripts && echo \"execFileSync('npx', ['wrangler', 'r2', 'object', 'put'])\" > scripts/canon.mjs && cfg '\"checks\":{\"postBuild\":[\"check:canon\"]}'"
expect_prepare "check submits to IndexNow"        "touches production"        "mkdir -p scripts && echo \"fetch('https://api.indexnow.org/IndexNow')\" > scripts/canon.mjs && cfg '\"checks\":{\"postBuild\":[\"check:canon\"]}'"
expect_prepare "build script pushes to git"       "writes to production"      "sed -i 's/\"build\": \"astro build\"/\"build\": \"astro build \&\& git push\"/' package.json"
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
built_case "structure: canonical off-site"        "not an absolute URL" $S "sed -i 's#https://example.com#https://staging.example.com#' dist/client/about/index.html"
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
echo
echo "Self-test: $pass passed, $failn failed."
[ "$failn" -eq 0 ]
