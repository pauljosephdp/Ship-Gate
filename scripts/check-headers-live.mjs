#!/usr/bin/env node
// Ship Gate post-deploy: what production answers to a plain request, and (optional) how real
// visitors experience it.
//
//   node check-headers-live.mjs   (reads SHIP_GATE_SITE_URL, SHIP_GATE_SMOKE_PATHS, CRUX_API_KEY)
//
// Access: fails when /, /robots.txt or a smoke path answers 403 or 429. A WAF or rate limit that
//   refuses an ordinary request refuses crawlers too, and an AI platform that gets 403/429 treats
//   the site as unreachable. This never spoofs a crawler's user agent: a correctly set WAF blocks
//   spoofed bots, so that test would fail good sites.
// Freshness: warns when a page answers without ETag or Last-Modified, the validators Bingbot
//   and other crawlers use to recrawl only what changed.
// Field Core Web Vitals (only with CRUX_API_KEY): p75 LCP ≤ 2500 ms, INP ≤ 200 ms, CLS ≤ 0.1
//   for phones, from the Chrome UX Report. Warns only; sites with too little traffic have no data.
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
    continue;
  }
  if (!res.ok) continue; // the smoke check reports other statuses
  if (!res.headers.get('etag') && !res.headers.get('last-modified'))
    console.log(`::warning::${p} has no ETag or Last-Modified header, so crawlers cannot ask "has this changed?" and refetch it in full.`);
  await res.arrayBuffer();
}

const key = process.env.CRUX_API_KEY;
if (key) {
  const LIMITS = { largest_contentful_paint: [2500, 'LCP', 'ms'], interaction_to_next_paint: [200, 'INP', 'ms'], cumulative_layout_shift: [0.1, 'CLS', ''] };
  // Field data only warns, so a network error reaching the API must not fail the job.
  let res;
  try {
    res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: site, formFactor: 'PHONE', metrics: Object.keys(LIMITS) }),
    });
  } catch (e) { res = { error: e }; }
  if (res.error) console.log(`::warning::Chrome UX Report unreachable (${res.error.message}); field Core Web Vitals not checked.`);
  else if (res.status === 404) console.log('Field Core Web Vitals: the Chrome UX Report has no data for this origin yet (too little traffic).');
  else if (!res.ok) console.log(`::warning::Chrome UX Report answered ${res.status}; field Core Web Vitals not checked.`);
  else {
    let metrics = null;
    try { metrics = (await res.json()).record?.metrics ?? {}; }
    catch (e) { console.log(`::warning::Chrome UX Report sent an unreadable answer (${e.message}); field Core Web Vitals not checked.`); }
    for (const [id, [limit, name, unit]] of Object.entries(metrics ? LIMITS : {})) {
      const p75 = Number(metrics[id]?.percentiles?.p75);
      if (!Number.isFinite(p75)) { console.log(`Field ${name}: no data.`); continue; }
      const line = `Field ${name} p75 on phones: ${p75}${unit} (good ≤ ${limit}${unit})`;
      console.log(p75 > limit ? `::warning::${line}.` : `${line}.`);
    }
  }
}

if (failed) process.exit(1);
console.log('Production answers plain requests.');
