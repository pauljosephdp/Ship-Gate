#!/usr/bin/env node
// Ship Gate post-deploy (analytics-always-on): production's home page carries Zaraz.
//
//   node check-analytics-live.mjs   (reads SHIP_GATE_SITE_URL; exported by prepare.mjs post-deploy)
//
// Zaraz is added by Cloudflare's edge, not the build, so production is the only place to see
// it: its loader under /cdn-cgi/zaraz/ goes into every HTML page it serves. Google Analytics
// runs as a Zaraz tool, so without the loader it runs nowhere. A missing loader warns rather
// than fails: a post-deploy failure means "roll back", and a Zaraz setting is not a fault in
// the deployed commit. PostHog is checked by check-posthog-live.mjs.
// No dependencies: Node built-ins only.

const site = process.env.SHIP_GATE_SITE_URL;

let html;
try {
  const res = await fetch(`${site}/`, { redirect: 'follow', headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  html = await res.text();
} catch (e) {
  console.log(`::error::Could not fetch production HTML to check analytics: ${e.message}.`);
  process.exit(1);
}

if (/\/cdn-cgi\/zaraz\//.test(html)) console.log('Production carries Zaraz, so Google Analytics runs.');
else console.log('::warning::Zaraz is not on production\'s home page (no /cdn-cgi/zaraz/ loader), so Google Analytics does not run. Turn Zaraz on for this zone and check the GA4 tool is enabled (templates/caller/analytics/zaraz-setup.md).');
