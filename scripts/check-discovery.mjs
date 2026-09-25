#!/usr/bin/env node
// Ship Gate discovery scan — SEO, AEO, GEO and AIO readiness of the built site.
//
//   node check-discovery.mjs        (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// Reads every file the build emits, no browser needed. The rules, their categories
// and default levels are in discovery.mjs; the site's levels arrive in run.json.
// Error-level findings fail the step; warnings are annotated and reported.
// A readiness table goes to the job summary and reports/discovery.md.
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlFiles, pageKind, attr, metaContent, assetsIgnore, parseRedirects, parseHeaders, compilePattern } from './site-files.mjs';
import {
  RULES, SEARCH_CRAWLERS, AI_SEARCH_CRAWLERS, AI_TRAINING_TOKENS, AI_AGENT_TOKENS, RETIRED_TOKENS, parseContentSignal,
  AGENT_LINK_RELS, parseLinkHeader, visibleText, normalise, ogContent, robotsDirectives,
  parseRobots, robotsAllows, parseSitemap, W3C_DATE, jsonLd, typesOf, missingProps, isEntity, isArticle,
} from './discovery.mjs';

const OUT = process.env.SHIP_GATE_DIR || '.ship-gate';
const run = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));
const { root, siteUrl } = run;
const cfg = run.discovery ?? {};
const levels = cfg.levels ?? Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.level]));
const ignoreLinks = cfg.ignoreLinks ?? [];

const findings = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
const add = (rule, where, msg) => findings[rule].push(`${where}: ${msg}`);
const notes = [];

// ── The build ──
const { ignored } = assetsIgnore(root);
const files = htmlFiles(root).map((p) => ({ ...p, html: readFileSync(p.file, 'utf8') }))
  .map((p) => ({ ...p, kind: pageKind(p.rel, p.html) }));
const pages = files.filter((p) => p.kind === 'page');
const pageByPath = new Map(pages.map((p) => [p.path, p]));
if (pages.length === 0) {
  console.log(`::error::No indexable HTML pages found in ${root}. Zero pages scanned is a failure, not a pass.`);
  process.exit(1);
}
const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const isFile = (rel) => { const f = join(root, rel); return existsSync(f) && statSync(f).isFile() && !ignored(rel); };
const dec = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
// A site path → the emitted file that serves it (as the static server would), or null.
const served = (path) => {
  const rel = dec(path).replace(/^\//, '');
  if (rel === '' || rel.endsWith('/')) return isFile(rel + 'index.html') ? rel + 'index.html' : null;
  return [rel, rel + '.html', rel + '/index.html'].find(isFile) ?? null;
};
const redirectRules = parseRedirects(read('_redirects') ?? '').rules.map((r) => compilePattern(r.from));
const onSite = (href) => href === siteUrl || href.startsWith(siteUrl + '/');
const pathOf = (url) => dec(new URL(url).pathname);

// ── robots.txt ──
const robotsText = read('robots.txt');
const robots = parseRobots(robotsText ?? '');
if (robotsText === null) add('robots-txt', 'robots.txt', 'not in the build. Add public/robots.txt so crawlers read your rules, not a platform default.');
for (const p of robots.problems) add('robots-txt', 'robots.txt', p);
if (robotsText !== null) {
  if (robots.groups.length === 0) add('robots-txt', 'robots.txt', 'has no "User-agent:" line, so it holds no rules for any crawler (RFC 9309). Start with "User-agent: *" and an Allow or Disallow line.');
  if (robots.sitemaps.length === 0) add('robots-sitemap', 'robots.txt', `no "Sitemap:" line. Add "Sitemap: ${siteUrl}/sitemap-index.xml" (or your sitemap's URL).`);
  for (const s of robots.sitemaps) if (!onSite(s)) add('robots-sitemap', 'robots.txt', `Sitemap "${s}" is not an absolute URL on ${siteUrl}.`);
}
for (const p of pages) {
  for (const bot of SEARCH_CRAWLERS)
    if (!robotsAllows(robots, bot, p.path)) add('robots-blocks-page', p.path, `indexable, but robots.txt blocks ${bot}. Allow it, or mark the page noindex.`);
}
for (const bot of AI_SEARCH_CRAWLERS) {
  const blocked = pages.filter((p) => !robotsAllows(robots, bot, p.path)).map((p) => p.path);
  if (blocked.length) add('ai-search-crawlers', 'robots.txt', `blocks ${bot} from ${blocked.length} indexable page(s) (${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ', …' : ''}). It fetches pages to answer and cite; blocking it removes the site from that product's answers. To opt out of model training only, block the training tokens (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot) instead.`);
}
const training = AI_TRAINING_TOKENS.filter((t) => !robotsAllows(robots, t, '/'));
notes.push(`AI training crawlers blocked at "/": ${training.length ? training.join(', ') : 'none'}.`);
if (robotsText !== null && robots.groups.length) {
  const named = new Set(robots.groups.flatMap((g) => g.agents));
  const explicit = AI_AGENT_TOKENS.filter((t) => named.has(t.toLowerCase()));
  if (explicit.length === 0) add('ai-crawler-rules', 'robots.txt', `names no AI crawler (${AI_AGENT_TOKENS.slice(0, 6).join(', ')}, …). The * group covers them, but an explicit group states the policy. A bot with its own group ignores the * group, so repeat any Disallow lines it must obey.`);
  for (const [t, now] of Object.entries(RETIRED_TOKENS)) if (named.has(t)) notes.push(`robots.txt names ${t}, which Anthropic no longer uses; ${now} are the current tokens.`);
}
const signals = robots.fields.filter((f) => f.field === 'content-signal');
if (robotsText !== null && signals.length === 0) add('content-signals', 'robots.txt', 'no "Content-Signal:" line. Declare how content may be used, inside the "User-agent: *" group, e.g. "Content-Signal: search=yes, ai-input=yes, ai-train=no" (contentsignals.org).');
for (const s of signals) {
  if (s.group === null) add('content-signals-format', 'robots.txt', `line ${s.line}: Content-Signal before any User-agent line; it applies to the group it sits in.`);
  for (const p of parseContentSignal(s.value).problems) add('content-signals-format', 'robots.txt', `line ${s.line}: Content-Signal ${p}.`);
  notes.push(`Content-Signal: ${s.value}`);
}

// ── Sitemap ──
const sitemapPaths = cfg.sitemap ? [cfg.sitemap]
  : robots.sitemaps.filter(onSite).map(pathOf).filter((p) => isFile(p.replace(/^\//, '')));
if (sitemapPaths.length === 0) for (const p of ['/sitemap-index.xml', '/sitemap.xml']) if (isFile(p.slice(1))) { sitemapPaths.push(p); break; }
const listed = new Map(); // path → lastmod
const seen = new Set();
const readSitemap = (path, from) => {
  if (seen.has(path)) return;
  seen.add(path);
  if (/\.gz$/i.test(path)) { add('sitemap', path, 'is gzipped; Ship Gate reads plain XML sitemaps only. Emit an uncompressed sitemap.'); return; }
  const xml = read(path.replace(/^\//, ''));
  if (xml === null) { add('sitemap', path, `${from ? `listed in ${from}, but ` : ''}not in the build.`); return; }
  const { kind, entries } = parseSitemap(xml);
  if (!kind) { add('sitemap', path, 'is neither a <urlset> nor a <sitemapindex>.'); return; }
  if (entries.length === 0) add('sitemap', path, 'lists nothing.');
  for (const e of entries) {
    if (!/^https?:\/\//.test(e.loc)) { add('sitemap', path, `<loc> "${e.loc}" is not an absolute URL.`); continue; }
    if (!onSite(e.loc)) { add('sitemap', path, `<loc> ${e.loc} is not on ${siteUrl}.`); continue; }
    if (e.lastmod !== undefined && !W3C_DATE.test(e.lastmod)) add('sitemap', path, `lastmod "${e.lastmod}" for ${e.loc} is not a W3C date.`);
    if (kind === 'index') readSitemap(pathOf(e.loc), path);
    else listed.set(pathOf(e.loc), e.lastmod);
  }
};
if (sitemapPaths.length === 0) add('sitemap', 'build', 'no sitemap found (robots.txt Sitemap line, /sitemap-index.xml or /sitemap.xml). Add @astrojs/sitemap or a static sitemap.');
for (const p of sitemapPaths) readSitemap(p);
// Agents and many tools probe /sitemap.xml without reading robots.txt first.
if (sitemapPaths.length && !isFile('sitemap.xml') && !redirectRules.some((match) => match('/sitemap.xml')))
  add('sitemap-xml', '/sitemap.xml', `not in the build. Add "/sitemap.xml ${sitemapPaths[0]} 301" to public/_redirects.`);

// ── Link headers on the home page (RFC 8288), from _headers ──
const headerText = read('_headers');
const homeLinks = headerText === null ? [] : parseHeaders(headerText).rules
  .filter((r) => compilePattern(r.pattern)('/') && !r.unset.includes('link'))
  .flatMap((r) => r.set.filter(([n]) => n === 'link').map(([, v]) => v));
const links = homeLinks.flatMap(parseLinkHeader);
if (homeLinks.length === 0) add('link-headers', '/', `no Link header in public/_headers for "/". Point agents at machine-readable resources, e.g. "Link: </llms.txt>; rel=\"describedby\"; type=\"text/markdown\"" (RFC 8288; rel ${AGENT_LINK_RELS.join(', ')}).`);
else if (!links.some((l) => l.rels.some((r) => AGENT_LINK_RELS.includes(r)))) add('link-headers', '/', `Link header has no rel of ${AGENT_LINK_RELS.join(', ')} (RFC 9727, RFC 8631).`);
for (const l of links) {
  for (const p of l.problems) add('link-headers', '/', `Link ${p}.`);
  if (!l.target) continue;
  let url;
  try { url = new URL(l.target, siteUrl + '/'); } catch { add('link-headers', '/', `Link target <${l.target}> is not a URL.`); continue; }
  if (url.origin === siteUrl && !served(url.pathname) && !redirectRules.some((match) => match(url.pathname)))
    add('link-headers', '/', `Link target <${l.target}> is not in the build.`);
}

// ── Pages ──
const canonicalOf = new Map();
for (const p of pages) {
  const html = p.html;
  const at = p.path;

  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang');
  if (!lang || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang)) add('html-lang', at, lang ? `lang="${lang}" is not a language tag.` : 'no lang attribute on <html>.');
  if (!/width\s*=\s*device-width/i.test(metaContent(html, 'viewport') ?? '')) add('viewport', at, 'no <meta name="viewport" content="width=device-width, initial-scale=1">.');

  // Canonical: exactly one, absolute on siteUrl, naming an indexable page exactly (no redirect hop).
  const canons = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\brel\s*=\s*["']?canonical\b/i.test(t));
  if (canons.length !== 1) add('canonical', at, `${canons.length} canonical links — a page has exactly one.`);
  const href = canons.length ? attr(canons[0], 'href') ?? '' : '';
  if (canons.length && !onSite(href)) add('canonical', at, `canonical "${href}" is not an absolute URL on ${siteUrl}.`);
  else if (canons.length) {
    const target = pathOf(href);
    canonicalOf.set(at, target);
    if (!pageByPath.has(target)) add('canonical', at, `canonical ${href} is not an indexable page in the build${served(target) ? ' (it redirects or is noindex)' : ''}.`);
  }

  // Internal links resolve to a built file or a _redirects rule.
  const broken = new Set();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const raw = attr(m[0], 'href');
    if (!raw || /^(#|mailto:|tel:|sms:|javascript:|data:)/i.test(raw)) continue;
    let url;
    try { url = new URL(raw.replace(/&amp;/g, '&'), siteUrl + at); } catch { broken.add(raw); continue; }
    if (url.origin !== siteUrl) continue;
    const path = url.pathname;
    if (ignoreLinks.some((pre) => path.startsWith(pre))) continue;
    if (served(path) || redirectRules.some((match) => match(path))) continue;
    broken.add(raw);
  }
  if (broken.size) add('internal-links', at, `${broken.size} link(s) to pages the build does not emit: ${[...broken].slice(0, 5).join(', ')}.`);

  // Open Graph: what AI chat apps and social cards show when the page is cited or shared.
  const miss = ['og:title', 'og:description', 'og:image'].filter((k) => !ogContent(html, k));
  if (miss.length) add('open-graph', at, `missing ${miss.join(', ')}.`);
  const img = ogContent(html, 'og:image');
  if (img && !/^https?:\/\//.test(img)) add('open-graph', at, `og:image "${img}" must be an absolute URL.`);
  else if (img && onSite(img) && !served(pathOf(img))) add('open-graph', at, `og:image ${img} is not in the build.`);
  const ogUrl = ogContent(html, 'og:url');
  if (ogUrl && !onSite(ogUrl)) add('open-graph', at, `og:url "${ogUrl}" is not on ${siteUrl}.`);

  // Structured data.
  const ld = jsonLd(html);
  for (const msg of ld.problems) add('structured-data', at, msg);
  for (const { node, context } of ld.tops) {
    if (!/schema\.org/.test(JSON.stringify(context ?? ''))) add('structured-data', at, `JSON-LD node ${typesOf(node).join('/') || '(untyped)'} has no schema.org @context.`);
    if (!typesOf(node).length) add('structured-data', at, 'JSON-LD node without @type.');
  }
  for (const node of ld.all) {
    const m = missingProps(node);
    if (m.length) add('structured-data', at, `${typesOf(node).join('/')} is missing ${m.join(', ')}.`);
  }
  const text = normalise(visibleText(html));
  for (const node of ld.all.filter((n) => typesOf(n).includes('FAQPage'))) {
    for (const q of [].concat(node.mainEntity ?? [])) {
      if (typeof q?.name === 'string' && q.name.trim() && !text.includes(normalise(q.name)))
        add('faq-visible', at, `FAQ question "${q.name.slice(0, 80)}" is in the markup but not on the page. Structured data must describe visible content.`);
    }
  }
  if (at === '/') {
    const entity = ld.all.find((n) => typesOf(n).some(isEntity));
    if (!entity) add('site-entity', at, 'no Organization, LocalBusiness or Person JSON-LD. Declare who is behind the site, with name and url.');
    else {
      if (typeof entity.url !== 'string' || !onSite(entity.url.replace(/\/$/, '') || entity.url)) add('site-entity', at, `${typesOf(entity)[0]} url must be on ${siteUrl}.`);
      if (!entity.sameAs || [].concat(entity.sameAs).length === 0) add('entity-sameas', at, `${typesOf(entity)[0]} has no sameAs links to its profiles (LinkedIn, Wikipedia, Crunchbase, social). They tie the site to one known entity.`);
    }
  }
  if (at.split('/').filter(Boolean).length >= 2 && !ld.all.some((n) => typesOf(n).includes('BreadcrumbList')))
    add('breadcrumbs', at, 'nested page without BreadcrumbList JSON-LD.');
  for (const a of ld.all.filter((n) => typesOf(n).some(isArticle)))
    if (!a.dateModified) add('article-dates', at, `${typesOf(a)[0]} has no dateModified; answer engines favour content they can date.`);

  const words = visibleText(html).split(/\s+/).filter(Boolean).length;
  if (words < 50) add('rendered-content', at, `${words} words of text in the HTML. Crawlers for AI answers mostly do not run JavaScript; render the content at build time.`);

  const d = robotsDirectives(html);
  if (d.includes('nosnippet') || d.some((x) => /^max-snippet:\s*0$/.test(x)))
    add('snippet-controls', at, `robots meta "${d.join(', ')}" stops Google quoting the page, in results and in AI Overviews and AI Mode.`);
  if (d.some((x) => /^max-image-preview:\s*none$/.test(x))) add('image-preview', at, 'max-image-preview:none hides the page\'s images in results and AI features.');
}

// Sitemap coverage: every indexable, self-canonical page, and nothing else.
if (sitemapPaths.length && !findings.sitemap.length) {
  for (const p of pages) {
    const canon = canonicalOf.get(p.path);
    if ((canon === undefined || canon === p.path) && !listed.has(p.path)) add('sitemap-coverage', p.path, 'indexable, but not in the sitemap.');
  }
  for (const path of listed.keys()) {
    const pg = pageByPath.get(path);
    const file = files.find((f) => f.path === path);
    if (pg && canonicalOf.get(path) !== undefined && canonicalOf.get(path) !== path)
      add('sitemap-coverage', path, `in the sitemap, but its canonical is ${canonicalOf.get(path)}. List the canonical URL instead.`);
    else if (!pg) add('sitemap-coverage', path, file ? `in the sitemap, but the page is ${file.kind}.` : served(path) ? 'in the sitemap, but that URL redirects (check the trailing slash).' : 'in the sitemap, but the build does not emit it.');
  }
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const noLastmod = [...listed].filter(([, l]) => l === undefined).map(([p]) => p);
  if (noLastmod.length) add('sitemap-lastmod', 'sitemap', `${noLastmod.length} URL(s) without lastmod (${noLastmod.slice(0, 3).join(', ')}). Bing and AI search use it to schedule recrawls.`);
  for (const [p, l] of listed) if (l && l.slice(0, 10) > tomorrow) add('sitemap-lastmod', p, `lastmod ${l} is in the future.`);
}

// llms.txt: a proposed standard (llmstxt.org). Some AI tools read it; Google Search does not.
const llms = read('llms.txt');
if (llms === null) add('llms-txt', 'llms.txt', 'not in the build. Optional, but cheap: a Markdown index of the pages you want AI tools to read.');
else {
  const lines = llms.split(/\r?\n/).filter((l) => l.trim());
  if (!/^# \S/.test(lines[0] ?? '')) add('llms-txt-format', 'llms.txt', 'must start with a "# Site name" heading.');
  if (!lines.some((l) => /^> \S/.test(l))) add('llms-txt-format', 'llms.txt', 'has no "> summary" blockquote line.');
  if (!/\]\([^)\s]+\)/.test(llms)) add('llms-txt-format', 'llms.txt', 'links to no pages.');
}

// ── Report ──
let failed = 0;
const rows = [];
for (const [id, rule] of Object.entries(RULES)) {
  const level = levels[id] ?? rule.level;
  const found = findings[id] ?? [];
  const result = rule.where === 'live' ? '➖ post-deploy' : level === 'off' ? '➖ off' : found.length === 0 ? '✅ pass' : level === 'error' ? '❌ fail' : '⚠️ warn';
  if (level !== 'off') {
    for (const f of found.slice(0, 20)) console.log(`::${level === 'error' ? 'error' : 'warning'}::[${rule.category} ${id}] ${f}`);
    if (found.length > 20) console.log(`::${level === 'error' ? 'error' : 'warning'}::[${rule.category} ${id}] …and ${found.length - 20} more.`);
    if (found.length && level === 'error') failed++;
  }
  rows.push(`| ${rule.category} | ${rule.title} (\`${id}\`) | ${result} | ${level === 'off' || !found.length ? '' : found[0].replace(/\|/g, '\\|').slice(0, 140)} |`);
}
for (const n of notes) console.log(n);
const md = ['## Discovery readiness (SEO, AEO, GEO, AIO)', '',
  `${pages.length} indexable page(s), ${listed.size} sitemap URL(s).`, '',
  '| Area | Check | Result | First finding |', '|---|---|---|---|', ...rows, '', ...notes.map((n) => `- ${n}`), ''].join('\n');
mkdirSync(join(OUT, 'reports'), { recursive: true });
writeFileSync(join(OUT, 'reports', 'discovery.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(`Discovery scan: ${pages.length} indexable page(s).`);
if (failed) { console.log(`Discovery scan: ${failed} rule(s) failed. See reports/discovery.md for the table.`); process.exit(1); }
console.log('Discovery scan passed.');
