// Ship Gate discovery rules — SEO, AEO, GEO and AIO readiness, and the parsers
// they need (robots.txt, sitemaps, JSON-LD). Shared by prepare.mjs (levels and
// overrides), check-discovery.mjs (the build scan) and check-live.mjs
// (what production serves after deploy).
// No dependencies: Node built-ins only, plus the generated schema-org-types.json.

import { readFileSync } from 'node:fs';
import { escapeRe, attr, metaTags } from './site-files.mjs';

// Every rule, its category and its default level. A site may raise a warning to an
// error freely; turning a rule down needs a reason and a restore date.
//   SEO — search engines can crawl, index and understand every page
//   AEO — answer engines can read the page as structured facts (schema.org JSON-LD)
//   GEO — generative engines (ChatGPT, Claude, Perplexity…) can reach, read and cite it
//   AIO — Google AI Overviews and AI Mode can quote it (indexed and snippet-eligible)
//   where: 'build' (the build scan), 'live' (post-deploy, against production) or 'both'.
export const RULES = {
  'robots-txt':         { category: 'SEO', level: 'error', where: 'both', title: 'robots.txt exists, parses and has a User-agent group' },
  'robots-sitemap':     { category: 'SEO', level: 'error', title: 'robots.txt names the sitemap on siteUrl' },
  'robots-blocks-page': { category: 'SEO', level: 'error', title: 'No indexable page is blocked for Googlebot or Bingbot' },
  sitemap:              { category: 'SEO', level: 'error', title: 'Sitemap exists, parses and lists only siteUrl' },
  'sitemap-coverage':   { category: 'SEO', level: 'error', title: 'Sitemap lists every indexable page and nothing else' },
  'sitemap-lastmod':    { category: 'SEO', level: 'warn',  title: 'Every sitemap URL has a plausible lastmod' },
  'sitemap-xml':        { category: 'SEO', level: 'warn',  title: '/sitemap.xml is served or redirects to the sitemap' },
  'sitemap-live':       { category: 'SEO', level: 'error', where: 'live', title: 'Every sitemap in production robots.txt answers 200 with XML' },
  canonical:            { category: 'SEO', level: 'error', title: 'One canonical per page, pointing at an indexable page' },
  'html-lang':          { category: 'SEO', level: 'error', title: 'The html element sets lang' },
  viewport:             { category: 'SEO', level: 'error', title: 'Mobile viewport meta tag' },
  'internal-links':     { category: 'SEO', level: 'error', title: 'Every internal link resolves' },
  'redirect-permanence':{ category: 'SEO', level: 'warn',  title: 'Static redirects are permanent (301/308)' },
  'rtl-direction':      { category: 'SEO', level: 'error', title: 'Right-to-left pages set dir="rtl"' },
  'hreflang-pairs':     { category: 'SEO', level: 'warn',  title: 'hreflang alternates exist and link back' },
  'structured-data':    { category: 'AEO', level: 'error', title: 'JSON-LD parses, uses schema.org and has the key properties' },
  'site-entity':        { category: 'AEO', level: 'error', title: 'Home page declares the Organization or Person behind the site' },
  'entity-sameas':      { category: 'AEO', level: 'warn',  title: 'The site entity links its profiles (sameAs)' },
  'faq-visible':        { category: 'AEO', level: 'error', title: 'FAQ markup matches questions visible on the page' },
  breadcrumbs:          { category: 'AEO', level: 'warn',  title: 'Nested pages carry BreadcrumbList markup' },
  'ai-search-crawlers': { category: 'GEO', level: 'error', title: 'AI search and user-fetch crawlers are not blocked' },
  'ai-crawler-rules':   { category: 'GEO', level: 'warn',  title: 'robots.txt states an explicit policy for AI crawlers' },
  'content-signals':    { category: 'GEO', level: 'warn',  title: 'robots.txt declares Content-Signal preferences' },
  'content-signals-format': { category: 'GEO', level: 'error', title: 'Content-Signal lines follow contentsignals.org' },
  'link-headers':       { category: 'GEO', level: 'warn',  where: 'both', title: 'Home page sends Link headers for agent discovery (RFC 8288)' },
  'markdown-negotiation': { category: 'GEO', level: 'warn', where: 'live', title: 'Accept: text/markdown returns Markdown' },
  'open-graph':         { category: 'GEO', level: 'error', title: 'Open Graph title, description and image' },
  'article-dates':      { category: 'GEO', level: 'warn',  title: 'Articles carry dateModified' },
  'rendered-content':   { category: 'GEO', level: 'warn',  title: 'Page text is in the HTML, not rendered by JavaScript' },
  'llms-txt':           { category: 'GEO', level: 'warn',  title: '/llms.txt exists' },
  'llms-txt-format':    { category: 'GEO', level: 'error', title: '/llms.txt follows the llmstxt.org format' },
  'markdown-mirrors':   { category: 'GEO', level: 'warn',  title: 'Markdown and text mirrors stay out of the search index' },
  'snippet-controls':   { category: 'AIO', level: 'warn',  title: 'Indexable pages allow text snippets' },
  'image-preview':      { category: 'AIO', level: 'warn',  title: 'Indexable pages allow image previews' },
};
export const LEVELS = { off: 0, warn: 1, error: 2 };

// Languages written right to left (ISO 639 primary subtags). A page in one of them needs
// dir="rtl", or browsers lay it out left to right and screen readers misread it.
export const RTL_LANGS = ['ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'];
// Other search engines' crawler tokens a site may add to robots-blocks-page with
// discovery.searchCrawlers (e.g. Baiduspider, Yeti for Naver, YandexBot, DuckDuckBot).
export const CRAWLER_TOKEN = /^[A-Za-z][A-Za-z0-9._-]{1,40}$/;

// Crawlers that fetch pages to answer a user or to build an AI search index. Blocking
// one removes the site from that product's answers and citations. Sources, Sept 2026:
// OpenAI, Anthropic, Perplexity, Apple and Google crawler documentation.
export const SEARCH_CRAWLERS = ['Googlebot', 'Bingbot'];
export const AI_SEARCH_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Applebot', 'DuckAssistBot'];
// Tokens that only control model training (or, for Google-Extended, Gemini training and
// grounding). Blocking them is a legitimate choice and never affects search; reported only.
export const AI_TRAINING_TOKENS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot',
  'meta-externalagent', 'Bytespider'];
// Any of these in a User-agent line counts as an explicit AI crawler policy.
export const AI_AGENT_TOKENS = [...AI_SEARCH_CRAWLERS.filter((t) => t !== 'Applebot'), ...AI_TRAINING_TOKENS, 'Amazonbot'];
// Tokens Anthropic no longer uses: a rule for them governs nothing.
export const RETIRED_TOKENS = { 'claude-web': 'ClaudeBot, Claude-SearchBot and Claude-User', 'anthropic-ai': 'ClaudeBot' };

// ── Text ──
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”',
  ldquo: '“', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™' };
export const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
// The words a reader sees: no scripts, styles, templates, comments, SVG or tags.
export const visibleText = (html) => decode((html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html)
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// For "does this sentence appear on the page": letters and digits only.
export const normalise = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const ogContent = (html, prop) => {
  const tag = metaTags(html).find((t) => (attr(t, 'property') ?? attr(t, 'name') ?? '').toLowerCase() === prop);
  return tag === undefined ? undefined : decode(attr(tag, 'content') ?? '').trim();
};
// Directives from <meta name="robots"> and <meta name="googlebot">, lower-cased.
export const robotsDirectives = (html) => metaTags(html)
  .filter((t) => /^(robots|googlebot)$/i.test(attr(t, 'name') ?? ''))
  .flatMap((t) => (attr(t, 'content') ?? '').toLowerCase().split(',').map((d) => d.trim()).filter(Boolean));

// ── robots.txt (RFC 9309) ──
// Returns { groups: [{ agents, rules: [{ allow, path }] }], sitemaps, fields: [{ field, value, line, group }], problems }.
// A field's group is the index of the group it sits in, or null before the first User-agent line.
export function parseRobots(text) {
  const groups = [], sitemaps = [], fields = [], problems = [];
  let cur = null, inAgents = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/);
    if (!m) { problems.push(`line ${i + 1}: "${line.slice(0, 60)}" is not "field: value"`); return; }
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') {
      if (!inAgents) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      inAgents = true;
      return;
    }
    if (field === 'sitemap') { sitemaps.push(value); return; }
    inAgents = false;
    if (field === 'allow' || field === 'disallow') {
      if (!cur) { problems.push(`line ${i + 1}: ${m[1]} before any User-agent line`); return; }
      if (value) cur.rules.push({ allow: field === 'allow', path: value });
      return;
    }
    fields.push({ field, value, line: i + 1, group: cur ? groups.length - 1 : null }); // Crawl-delay, Content-Signal and others: crawlers ignore what they don't know
  });
  return { groups, sitemaps, fields, problems };
}

const ruleRe = (p) => {
  const anchored = p.endsWith('$');
  return new RegExp('^' + (anchored ? p.slice(0, -1) : p).split('*').map(escapeRe).join('.*') + (anchored ? '$' : ''));
};
// May this crawler fetch this path? The crawler's own groups, else the * groups;
// the longest matching rule wins, and Allow wins a tie.
export function robotsAllows(robots, agent, path) {
  const ua = agent.toLowerCase();
  let groups = robots.groups.filter((g) => g.agents.includes(ua));
  if (groups.length === 0) groups = robots.groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const r of groups.flatMap((g) => g.rules)) {
    if (!ruleRe(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

// ── Content Signals (contentsignals.org, draft-romm-aipref-contentsignals) ──
export const CONTENT_SIGNALS = ['search', 'ai-input', 'ai-train'];
// "search=yes, ai-train=no" → { entries: { search: 'yes', … }, problems }.
export function parseContentSignal(value) {
  const entries = {}, problems = [];
  for (const part of value.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([\w-]+)\s*=\s*(yes|no)$/i);
    if (!m) { problems.push(`"${part}" is not "signal=yes" or "signal=no"`); continue; }
    const key = m[1].toLowerCase();
    if (!CONTENT_SIGNALS.includes(key)) { problems.push(`"${m[1]}" is not a signal (use ${CONTENT_SIGNALS.join(', ')})`); continue; }
    if (key in entries) problems.push(`"${key}" is set twice`);
    entries[key] = m[2].toLowerCase();
  }
  if (!Object.keys(entries).length && !problems.length) problems.push('is empty');
  return { entries, problems };
}

// ── Link header (RFC 8288) ──
// Relation types that point an agent at machine-readable descriptions (RFC 9727 §3, RFC 8631).
export const AGENT_LINK_RELS = ['api-catalog', 'service-desc', 'service-doc', 'describedby'];
// One Link field value → [{ target, rels, problems }]. Commas split links only outside <…> and quotes.
export function parseLinkHeader(value) {
  const parts = [];
  let buf = '', inUri = false, inQuote = false;
  for (const ch of value) {
    if (inQuote) { if (ch === '"') inQuote = false; buf += ch; continue; }
    if (ch === '"' && !inUri) inQuote = true;
    else if (ch === '<') inUri = true;
    else if (ch === '>') inUri = false;
    else if (ch === ',' && !inUri) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^<([^>]*)>\s*(.*)$/);
    if (!m) return { target: null, rels: [], problems: [`"${p.slice(0, 60)}" does not start with <URI>`] };
    const params = {};
    const problems = [];
    for (const raw of m[2].split(';').map((x) => x.trim()).filter(Boolean)) {
      const pm = raw.match(/^([A-Za-z0-9!#$&+.^_`|~*-]+)\s*(?:=\s*("([^"]*)"|[^\s";]+))?$/);
      if (!pm) { problems.push(`<${m[1]}>: parameter "${raw.slice(0, 40)}" does not parse`); continue; }
      const k = pm[1].toLowerCase();
      if (!(k in params)) params[k] = pm[3] ?? pm[2] ?? '';
    }
    if (m[2].trim() && !m[2].trim().startsWith(';')) problems.push(`<${m[1]}>: parameters must follow ";"`);
    if (!params.rel) problems.push(`<${m[1]}> has no rel parameter`);
    return { target: m[1], rels: (params.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean), problems };
  });
}

// ── Sitemaps ──
const xmlText = (s) => decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
// Returns { kind: 'index'|'urlset'|null, entries: [{ loc, lastmod }] }.
export function parseSitemap(xml) {
  const kind = /<sitemapindex\b/i.test(xml) ? 'index' : /<urlset\b/i.test(xml) ? 'urlset' : null;
  const tag = kind === 'index' ? 'sitemap' : 'url';
  const entries = [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => ({
    loc: xmlText(m[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1] ?? ''),
    lastmod: m[1].match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim(),
  }));
  return { kind, entries };
}
export const W3C_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

// ── JSON-LD ──
export const typesOf = (node) => [].concat(node?.['@type'] ?? []).filter((t) => typeof t === 'string')
  .map((t) => t.replace(/^.*[/:#]/, ''));
// Every JSON-LD block on the page. Returns { tops: [{ node, context }], all: [typed nodes], problems }.
export function jsonLd(html) {
  const tops = [], all = [], problems = [];
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => /^application\/ld\+json$/i.test((attr(`<x ${m[1]}>`, 'type') ?? '').trim()));
  blocks.forEach((m, i) => {
    let data;
    try { data = JSON.parse(m[2]); } catch (e) { problems.push(`JSON-LD block ${i + 1} is not valid JSON (${e.message.slice(0, 80)})`); return; }
    for (const top of [].concat(data)) {
      if (!top || typeof top !== 'object') { problems.push(`JSON-LD block ${i + 1} holds a non-object`); continue; }
      const context = top['@context'];
      for (const node of Array.isArray(top['@graph']) ? top['@graph'] : [top]) tops.push({ node, context: node?.['@context'] ?? context });
    }
  });
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (typesOf(v).length) all.push(v);
    for (const [k, x] of Object.entries(v)) if (k !== '@context') walk(x);
  };
  tops.forEach((t) => walk(t.node));
  return { tops, all, problems };
}

const has = (v) => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && v.length === 0);
const ARTICLE = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle'];
// Every schema.org Organization and LocalBusiness subtype (Hotel, Dentist, Plumber…),
// generated by tools/schema-org-types.mjs.
const SCHEMA_TYPES = JSON.parse(readFileSync(new URL('./schema-org-types.json', import.meta.url), 'utf8'));
export const LOCAL_BUSINESS = SCHEMA_TYPES.localBusiness;
export const isEntity = (t) => t === 'Person' || SCHEMA_TYPES.organization.includes(t)
  || /Organization$|Corporation$|Business$|^NGO$|^OnlineStore$/.test(t);
export const isArticle = (t) => ARTICLE.includes(t);

// The properties Ship Gate needs before a node is useful to an answer engine: Google's
// required properties where it defines them, otherwise the ones that identify the thing.
export function missingProps(node) {
  const types = typesOf(node), miss = [];
  const need = (...ks) => { for (const k of ks) if (!has(node[k])) miss.push(k); };
  if (types.some(isArticle)) need('headline', 'datePublished', 'author');
  if (types.some((t) => LOCAL_BUSINESS.includes(t))) need('name', 'address');
  else if (types.some(isEntity)) need('name');
  if (types.includes('WebSite')) need('name', 'url');
  if (types.includes('Product')) { need('name'); if (!has(node.offers) && !has(node.review) && !has(node.aggregateRating)) miss.push('offers, review or aggregateRating'); }
  if (types.includes('Event')) need('name', 'startDate', 'location');
  if (types.includes('Recipe')) need('name', 'image');
  if (types.includes('VideoObject')) need('name', 'thumbnailUrl', 'uploadDate');
  if (types.includes('FAQPage')) {
    const qs = [].concat(node.mainEntity ?? []);
    if (qs.length === 0) miss.push('mainEntity');
    qs.forEach((q, i) => {
      if (!typesOf(q).includes('Question') || !has(q.name)) miss.push(`mainEntity[${i}] Question name`);
      const a = [].concat(q?.acceptedAnswer ?? [])[0];
      if (!has(a?.text)) miss.push(`mainEntity[${i}] acceptedAnswer.text`);
    });
  }
  if (types.includes('BreadcrumbList')) {
    const items = [].concat(node.itemListElement ?? []);
    if (items.length === 0) miss.push('itemListElement');
    items.forEach((it, i) => {
      if (!has(it?.position)) miss.push(`itemListElement[${i}].position`);
      if (!has(it?.name) && !has(it?.item?.name)) miss.push(`itemListElement[${i}].name`);
      if (i < items.length - 1 && !has(it?.item)) miss.push(`itemListElement[${i}].item`);
    });
  }
  return miss;
}
