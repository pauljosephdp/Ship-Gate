#!/usr/bin/env node
// Ship Gate post-deploy: what production actually serves to crawlers and agents. A
// CDN or platform setting (managed robots.txt, "block AI bots", transform rules) can
// change it after the build passed the gate.
//
//   node check-live.mjs   (reads SHIP_GATE_SITE_URL, SHIP_GATE_SMOKE_PATHS, SHIP_GATE_DISCOVERY_LEVELS)
//
// robots-txt: 200, text/plain, at least one User-agent group, and no Googlebot,
//   Bingbot, crawler in discovery.searchCrawlers (SHIP_GATE_SEARCH_CRAWLERS) or AI
//   search crawler blocked from a smoke path (ai-search-crawlers).
// ai-training, ai-uses-allowed: training per SHIP_GATE_AI_TRAINING ("block" by default:
//   training crawlers disallowed; "reserve": they may fetch, but the group governing each
//   says Content-Signal ai-train=no; "allow"); search and AI input never signalled off.
// sitemap-live: every on-site Sitemap in robots.txt answers 200 with a sitemap.
// link-headers: the home page sends a Link header with an agent-discovery rel.
// markdown-negotiation: Accept: text/markdown gets Markdown; browsers still get HTML.
// Levels are the site's discovery levels (discoveryOverrides apply here too).
// No dependencies: Node built-ins only.

import {
  RULES, SEARCH_CRAWLERS, AI_SEARCH_CRAWLERS, AGENT_LINK_RELS, trainingPolicy,
  parseRobots, robotsAllows, parseSitemap, parseLinkHeader,
} from './discovery.mjs';

const site = process.env.SHIP_GATE_SITE_URL;
const extra = (process.env.SHIP_GATE_SEARCH_CRAWLERS || '').split(/\s+/).filter(Boolean);
const paths = (process.env.SHIP_GATE_SMOKE_PATHS || '/').split(/\s+/).filter((p) => p && !/\.(txt|xml)$/.test(p));
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
else if (!res.ok) add('robots-txt', `Production robots.txt answered ${res.status || res.error}. Crawlers treat 5xx as "disallow everything".`);
else {
  robots = parseRobots(await res.text());
  if (type(res) !== 'text/plain') add('robots-txt', `Production robots.txt is served as "${type(res) || 'no Content-Type'}"; RFC 9309 expects text/plain.`);
  if (robots.groups.length === 0) add('robots-txt', 'Production robots.txt has no "User-agent:" line, so it holds no rules. Check the CDN\'s managed robots.txt.');
  for (const bot of [...SEARCH_CRAWLERS, ...extra, ...AI_SEARCH_CRAWLERS]) {
    const blocked = paths.filter((p) => !robotsAllows(robots, bot, p));
    if (blocked.length) add(AI_SEARCH_CRAWLERS.includes(bot) ? 'ai-search-crawlers' : 'robots-blocks-page',
      `Production robots.txt blocks ${bot} from ${blocked.join(', ')}. Check the CDN's managed robots.txt and AI-crawler settings.`);
  }
  for (const f of trainingPolicy(robots, process.env.SHIP_GATE_AI_TRAINING || 'block')) add(f.rule, `Production robots.txt ${f.msg} Check the CDN's managed robots.txt.`);
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

// ── Home page: Link headers and Markdown negotiation ──
const html = await get('/', { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' });
const linkValue = html.headers.get('link');
if (!linkValue) add('link-headers', `The home page sends no Link header. Add one pointing agents at machine-readable resources (rel ${AGENT_LINK_RELS.join(', ')}).`);
else {
  const links = parseLinkHeader(linkValue);
  for (const l of links) for (const p of l.problems) add('link-headers', `Link ${p}.`);
  if (!links.some((l) => l.rels.some((r) => AGENT_LINK_RELS.includes(r)))) add('link-headers', `The home page Link header has no rel of ${AGENT_LINK_RELS.join(', ')}.`);
}
if (html.ok && type(html) !== 'text/html') add('markdown-negotiation', `A browser request for / got "${type(html)}"; HTML must stay the default.`);
const md = await get('/', { accept: 'text/markdown' });
if (!md.ok) add('markdown-negotiation', `Accept: text/markdown on / answered ${md.status || md.error}.`);
else if (type(md) !== 'text/markdown') add('markdown-negotiation', `Accept: text/markdown on / got "${type(md) || 'no Content-Type'}". Enable Markdown for Agents (Cloudflare) or serve a Markdown variant.`);
else console.log(`Markdown for agents: served${md.headers.get('x-markdown-tokens') ? `, ${md.headers.get('x-markdown-tokens')} tokens` : ''}.`);

// ── Report ──
let failed = 0;
for (const { rule, msg } of findings) {
  const level = levelOf(rule);
  if (level === 'off') continue;
  console.log(`::${level === 'error' ? 'error' : 'warning'}::[${RULES[rule].category} ${rule}] ${msg}`);
  if (level === 'error') failed++;
}
if (failed) process.exit(1);
console.log('Production lets search engines, AI search crawlers and agents in.');
