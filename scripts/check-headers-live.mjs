#!/usr/bin/env node
// Ship Gate post-deploy: production answers a plain request.
//
//   node check-headers-live.mjs   (reads SHIP_GATE_SITE_URL, SHIP_GATE_SMOKE_PATHS)
//
// Fails when /, /robots.txt or a smoke path answers 403 or 429. A WAF or rate limit that refuses
// an ordinary request refuses crawlers too, and an AI platform that gets 403/429 treats the site
// as unreachable. This never spoofs a crawler's user agent: a correctly set WAF blocks spoofed
// bots, so that test would fail good sites. Freshness headers and field Core Web Vitals are live
// behaviour, not deploy health: website-audit checks them.
// No dependencies: Node built-ins only.

const site = process.env.SHIP_GATE_SITE_URL;
const smoke = (process.env.SHIP_GATE_SMOKE_PATHS || '/').split(/\s+/).filter(Boolean);
const paths = [...new Set(['/', '/robots.txt', ...smoke])];
let failed = false;

for (const p of paths) {
  let res;
  try { res = await fetch(`${site}${p}`, { redirect: 'follow' }); } catch (e) { console.log(`::error::${p}: request failed (${e.message}).`); failed = true; continue; }
  if (res.status === 403 || res.status === 429) {
    console.log(`::error::${p} answered ${res.status} to a plain request. A WAF rule, bot challenge or rate limit is refusing ordinary traffic, and crawlers with it. Check the CDN's security events.`);
    failed = true;
  }
  await res.arrayBuffer();
}

if (failed) process.exit(1);
console.log('Production answers plain requests.');
