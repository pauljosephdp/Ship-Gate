#!/usr/bin/env node
// Ship Gate post-deploy: the crawler files production serves answer, with the right type.
// Deploy health only. What production tells crawlers and agents beyond that (which crawlers its
// robots.txt lets in, Link headers, Markdown negotiation, field data) is live behaviour that a CDN
// setting can change between deploys: website-audit owns it and checks it on production.
//
//   node check-live.mjs   (reads SHIP_GATE_SITE_URL, SHIP_GATE_DISCOVERY_LEVELS)
//
// robots-txt: 200 (a 404 warns: every crawler is then allowed), text/plain, at least one
//   User-agent group. A 5xx makes Google pause crawling.
// sitemap-live: every on-site Sitemap in robots.txt answers 200 with XML that is a sitemap.
// Levels are the site's discovery levels (discoveryOverrides apply here too).
// No dependencies: Node built-ins only.

import { RULES, parseRobots, parseSitemap } from './discovery.mjs';

const site = process.env.SHIP_GATE_SITE_URL;
let levels = {};
try { levels = JSON.parse(process.env.SHIP_GATE_DISCOVERY_LEVELS || '{}'); } catch { /* defaults */ }
const levelOf = (rule) => levels[rule] ?? RULES[rule].level;
const findings = [];
const add = (rule, msg) => findings.push({ rule, msg });
const cb = () => `cb=${Date.now()}`;
const get = async (path, headers = {}) => {
  try { return await fetch(`${site}${path}${path.includes('?') ? '&' : '?'}${cb()}`, { headers, redirect: 'follow' }); }
  catch (e) { return { ok: false, status: 0, headers: new Headers(), text: async () => '', error: e.message }; }
};
const type = (res) => (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

// ── robots.txt ──
const res = await get('/robots.txt');
let robots = parseRobots('');
if (res.status === 404) console.log('::warning::Production serves no robots.txt — every crawler is allowed.');
else if (!res.ok) add('robots-txt', `Production robots.txt answered ${res.status || res.error}. Google pauses crawling on a 5xx.`);
else {
  robots = parseRobots(await res.text());
  if (type(res) !== 'text/plain') add('robots-txt', `Production robots.txt is served as "${type(res) || 'no Content-Type'}"; RFC 9309 expects text/plain.`);
  if (robots.groups.length === 0) add('robots-txt', 'Production robots.txt has no "User-agent:" line, so it holds no rules. Check the CDN\'s managed robots.txt.');
}

// ── Sitemaps named in robots.txt ──
for (const s of robots.sitemaps) {
  let url;
  try { url = new URL(s); } catch { add('sitemap-live', `Sitemap "${s}" in production robots.txt is not a URL.`); continue; }
  if (url.origin !== site) continue;
  const r = await get(url.pathname + url.search);
  if (!r.ok) { add('sitemap-live', `Sitemap ${s} answered ${r.status || r.error}.`); continue; }
  if (!/^(application|text)\/xml$/.test(type(r))) add('sitemap-live', `Sitemap ${s} is served as "${type(r) || 'no Content-Type'}", not XML.`);
  if (!parseSitemap(await r.text()).kind) add('sitemap-live', `Sitemap ${s} is neither a <urlset> nor a <sitemapindex>.`);
}

// ── Report ──
let failed = 0;
for (const { rule, msg } of findings) {
  const level = levelOf(rule);
  if (level === 'off') continue;
  console.log(`::${level === 'error' ? 'error' : 'warning'}::[${RULES[rule].category} ${rule}] ${msg}`);
  if (level === 'error') failed++;
}
if (failed) process.exit(1);
console.log('Production serves robots.txt and its sitemaps.');
