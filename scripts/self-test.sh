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
  echo "22" > .nvmrc
  cat > package.json <<'JSON'
{
  "type": "module",
  "scripts": { "check": "astro check", "lint": "eslint .", "build": "astro build", "preview": "astro preview" },
  "dependencies": { "posthog-node": "^5.0.0" },
  "devDependencies": { "@astrojs/check": "1", "@playwright/test": "1", "@axe-core/playwright": "4", "@lhci/cli": "0.14" }
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
  out="$(GITHUB_ENV= node "$PREPARE" verify 2>&1)"; code=$?
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
expect_guard "Node version not pinned"            ".nvmrc missing"            "rm .nvmrc"

echo "Config and contract (prepare.mjs)"
expect_prepare "conforming site passes"           pass ":"
expect_prepare "missing standard script"          "missing the \"lint\" script" "sed -i 's/\"lint\": \"eslint .\", //' package.json"
expect_prepare "missing dev dependency"           "Missing dev dependency @lhci/cli" "sed -i 's/, \"@lhci\/cli\": \"0.14\"//' package.json"
expect_prepare "siteUrl with trailing slash"      "siteUrl must be"           "sed -i 's#https://example.com#https://example.com/#' ship-gate.config.json"
expect_prepare "empty pages list"                 "pages must be"             "sed -i 's#\"pages\": \\[\"/\", \"/contact/\"\\]#\"pages\": []#' ship-gate.config.json"
expect_prepare "override without reason"          "a real reason is required" "echo '{\"siteUrl\":\"https://example.com\",\"pages\":[\"/\"],\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"\",\"restoreBy\":\"$FUTURE\"}]}' > ship-gate.config.json"
expect_prepare "expired override"                 "override expired"          "echo '{\"siteUrl\":\"https://example.com\",\"pages\":[\"/\"],\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$PAST\"}]}' > ship-gate.config.json"
expect_prepare "override not actually lower"      "below the standard"        "echo '{\"siteUrl\":\"https://example.com\",\"pages\":[\"/\"],\"thresholdOverrides\":[{\"category\":\"seo\",\"minScore\":0.99,\"reason\":\"Should never be accepted\",\"restoreBy\":\"$FUTURE\"}]}' > ship-gate.config.json"
expect_prepare "valid override accepted"          pass                        "echo '{\"siteUrl\":\"https://example.com\",\"pages\":[\"/\"],\"thresholdOverrides\":[{\"category\":\"performance\",\"minScore\":0.85,\"reason\":\"Hero video pending re-encode\",\"restoreBy\":\"$FUTURE\"}]}' > ship-gate.config.json"
expect_prepare "old local kit copy present"       "local copy of the old ship-gate kit" "mkdir -p scripts && echo x > scripts/guards.sh"
expect_prepare "missing config file"              "not found"                 "rm ship-gate.config.json"

echo
echo "Self-test: $pass passed, $failn failed."
[ "$failn" -eq 0 ]
