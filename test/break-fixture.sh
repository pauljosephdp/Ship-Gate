#!/usr/bin/env bash
# Breaks the fixture site one way, so self-test.yml can prove the gate turns red for it.
#   break-fixture.sh VARIANT   (run from the repo root)
# Restores the committed fixture first, so one job can run several variants in turn.
# The site's and the test tools' node_modules survive: the lockfiles never change
# between variants, and the action reuses them in fixture mode instead of reinstalling.
set -euo pipefail
cd "$(dirname "$0")/fixture-site"
git checkout -q -- .
git clean -ffdxq -e node_modules .
if [ -n "${SHIP_GATE_DIR:-}" ] && [ -d "$SHIP_GATE_DIR" ]; then
  find "$SHIP_GATE_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
fi
index=src/pages/index.astro
add() { sed -i "s#<h2>What this is</h2>#<h2>What this is</h2>$1#" "$index"; }
# posthog-hybrid, set up as a site would: the templates in templates/caller/posthog, the
# build-time markers, <PostHog /> in the base layout, the policy, and the CSP PostHog needs.
# The SDK versions are pinned here: the committed fixture is a posthog-server-only site,
# whose guards forbid posthog-js in package.json.
POSTHOG_PACKAGES="posthog-js@1.434.14 posthog-node@5.54.0"
POSTHOG_CSP="script-src 'self' https://eu-assets.i.posthog.com; connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com; worker-src 'self' blob:; img-src 'self' data: https://eu.i.posthog.com; "
posthog_hybrid() {
  local t=../../templates/caller/posthog
  mkdir -p src/components src/lib/server
  cp "$t/src/lib/posthog-options.ts" src/lib/
  cp "$t/src/lib/server/analytics.ts" src/lib/server/
  cp "$t/src/components/PostHog.astro" src/components/
  cp "$t/src/env.d.ts" src/
  cat > astro.config.mjs <<'JS'
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://example.com', output: 'static', trailingSlash: 'always',
  vite: {
    define: {
      __BUILD_SHA__: JSON.stringify(process.env.WORKERS_CI_COMMIT_SHA ?? 'local'),
      __DEPLOY_ENV__: JSON.stringify(
        process.env.WORKERS_CI_BRANCH === 'main' ? 'production'
          : process.env.WORKERS_CI ? 'preview' : 'local'),
    },
  },
});
JS
  # The Worker's runtime secrets, declared so deploys fail without them (guards.sh warns otherwise).
  printf '{ "name": "fixture", "secrets": { "required": ["POSTHOG_API_KEY", "TURNSTILE_SECRET_KEY"] } }\n' > wrangler.jsonc
  sed -i '1s#^---$#---\nimport PostHog from "../components/PostHog.astro";#' src/layouts/Base.astro
  sed -i 's#</head>#  <PostHog />\n  </head>#' src/layouts/Base.astro
  node -e '
    const fs = require("fs"); const c = JSON.parse(fs.readFileSync("ship-gate.config.json", "utf8"));
    c.policies = c.policies.map((p) => (p === "posthog-server-only" ? "posthog-hybrid" : p));
    c.posthog = { embed: "npm", cookieless: "on_reject" };
    fs.writeFileSync("ship-gate.config.json", JSON.stringify(c, null, 2) + "\n");'
  # shellcheck disable=SC2086 # one word per package
  npm install --save --no-audit --no-fund --loglevel=error $POSTHOG_PACKAGES
}
posthog_csp() { sed -i "s#default-src 'self'; #default-src 'self'; $POSTHOG_CSP#" public/_headers; }
# analytics-always-on on top of posthog-hybrid: the Zaraz consent bridge, kept a same-origin
# file (Astro inlines small scripts, which a CSP without 'unsafe-inline' blocks). Zaraz itself
# runs only on Cloudflare's edge, so the fixture has none.
analytics_always_on() {
  cp ../../templates/caller/posthog/optional/src/components/PostHogZarazConsent.astro src/components/
  sed -i '1s#^---$#---\nimport PostHogZarazConsent from "../components/PostHogZarazConsent.astro";#' src/layouts/Base.astro
  sed -i 's#  <PostHog />#  <PostHog />\n    <PostHogZarazConsent />#' src/layouts/Base.astro
  sed -i 's#  vite: {#  vite: {\n    build: { assetsInlineLimit: (file) => (/ZarazConsent/.test(file) ? false : undefined) },#' astro.config.mjs
  node -e '
    const fs = require("fs"); const c = JSON.parse(fs.readFileSync("ship-gate.config.json", "utf8"));
    c.policies.push("analytics-always-on");
    fs.writeFileSync("ship-gate.config.json", JSON.stringify(c, null, 2) + "\n");'
}
case "$1" in
  conforming) ;;
  missing-alt) echo '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' > public/dot.svg; add '<img src="/dot.svg" width="8" height="8">' ;;
  wide-element) add '<div style="width:420px">A block wider than a phone.</div>' ;;
  csp-violation) add '<script is:inline src="https://cdn.example.org/widget.js"></script>' ;;
  bad-redirect) echo '/old-contact /contact-us/ 301' >> public/_redirects ;;
  two-h1) add '<h1>A second top-level heading</h1>' ;;
  blocks-ai-search) printf '\nUser-agent: PerplexityBot\nDisallow: /\n' >> public/robots.txt ;;
  robots-no-agents) printf 'Sitemap: https://example.com/sitemap.xml\n' > public/robots.txt ;;
  allows-training) sed -i '/^User-agent: GPTBot$/,/^Disallow: \/$/d' public/robots.txt ;;
  bad-jsonld) add '<script type="application/ld+json" set:html="{not json" />' ;;
  rtl-no-dir) sed -i 's# dir={dir}##' src/layouts/Base.astro ;;
  google-font) add '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' ;;
  no-focus-ring) add '<p><a href="/contact/" style="outline:none">Write to the fixture</a></p>' ;;
  tracker-cookie) printf '/\n  Set-Cookie: _ga=GA1.1.123.456; Path=/\n' >> public/_headers ;;
  vendor-named-asset) echo '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' > public/hubspot-partner-badge.svg; add '<img src="/hubspot-partner-badge.svg" alt="HubSpot partner" width="8" height="8">' ;;
  posthog-hybrid-missing) posthog_hybrid; posthog_csp; sed -i 's#<PostHog />#{Astro.url.pathname === "/" \&\& <PostHog />}#' src/layouts/Base.astro ;;
  posthog-hybrid-csp) posthog_hybrid ;;
  analytics-always-on) posthog_hybrid; posthog_csp; analytics_always_on ;;
  direct-tag) add '<script is:inline async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script>' ;;
  *) echo "Unknown variant: $1" >&2; exit 2 ;;
esac
echo "Fixture variant: $1"
