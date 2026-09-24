#!/usr/bin/env node
// Ship Gate structure scan — reads every page the build emits, no browser needed.
//
//   node check-structure.mjs        (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// Indexable pages: one h1, no skipped heading levels, target=_blank links carry
// noopener, a title and meta description within the site's bands and unique
// across the site, and a canonical (when present) on siteUrl.
// Every file: no unrendered {{template}} tokens.
// Edge files: _headers and _redirects parse, with no merge-conflict markers.
// llms.txt: every on-site link resolves to a built file.
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { indexablePages, metaContent, attr, parseHeaders, parseRedirects } from './site-files.mjs';

const OUT = process.env.SHIP_GATE_DIR || '.ship-gate';
const run = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));
const { root, siteUrl, structure: band } = run;

const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);
const warn = (m) => console.log(`::warning::${m}`);

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
// Markup a reader sees: no scripts, styles, templates, comments or inline SVG.
const visible = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1>/gi, '');

const pages = indexablePages(root);
if (pages.length === 0) {
  console.log(`::error::No indexable HTML pages found in ${root}. Zero pages scanned is a failure, not a pass.`);
  process.exit(1);
}

const titles = new Map();
const descs = new Map();
for (const p of pages) {
  const html = visible(p.html);
  const at = p.path;

  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) bad(at, `${h1} <h1> elements — a page has exactly one.`);
  let prev = 0;
  for (const m of html.matchAll(/<h([1-6])\b/gi)) {
    const lvl = Number(m[1]);
    if (prev && lvl > prev + 1) { bad(at, `heading jumps from h${prev} to h${lvl} — no skipped levels.`); break; }
    prev = lvl;
  }

  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    if ((attr(m[0], 'target') ?? '').toLowerCase() !== '_blank') continue;
    if (!/\bnoopener\b|\bnoreferrer\b/i.test(attr(m[0], 'rel') ?? ''))
      bad(at, `target="_blank" link without rel="noopener" (${(attr(m[0], 'href') ?? '?').slice(0, 80)}).`);
  }

  const title = decode(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  if (!title) bad(at, 'no <title>.');
  else {
    if (band.titleMax && title.length > band.titleMax) bad(at, `title is ${title.length} characters, over ${band.titleMax}: "${title}"`);
    if (band.titleMin && title.length < band.titleMin) bad(at, `title is ${title.length} characters, under ${band.titleMin}: "${title}"`);
    titles.set(title, [...(titles.get(title) ?? []), at]);
  }
  const desc = decode(metaContent(p.html, 'description') ?? '').trim();
  if (!desc) bad(at, 'no meta description.');
  else {
    if (band.descMax && desc.length > band.descMax) bad(at, `meta description is ${desc.length} characters, over ${band.descMax}.`);
    if (band.descMin && desc.length < band.descMin) bad(at, `meta description is ${desc.length} characters, under ${band.descMin}.`);
    descs.set(desc, [...(descs.get(desc) ?? []), at]);
  }

  const canon = [...p.html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\brel\s*=\s*["']?canonical\b/i.test(t));
  if (canon) {
    const href = attr(canon, 'href') ?? '';
    if (!href.startsWith(siteUrl + '/') && href !== siteUrl) bad(at, `canonical "${href}" is not an absolute URL on ${siteUrl}.`);
  }
}
for (const [t, where] of titles) if (where.length > 1) bad(where.join(', '), `share the title "${t}" — every page needs its own.`);
for (const [d, where] of descs) if (where.length > 1) bad(where.join(', '), `share the meta description "${d.slice(0, 60)}…".`);

// Unrendered template tokens anywhere a reader or crawler can see.
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return d === root && n === '_worker.js' ? [] : walk(p);
  return /\.(html|txt|md|xml|json|webmanifest)$/.test(n) ? [p] : [];
});
for (const f of walk(root)) {
  let text = readFileSync(f, 'utf8');
  if (f.endsWith('.html')) text = visible(text).replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, '');
  const m = text.match(/\{\{\s*[\w.$-]+\s*\}\}/);
  if (m) bad(relative(root, f).split(sep).join('/'), `unrendered template token ${m[0]}.`);
}

// Edge files: a typo here silently drops headers or redirects in production.
for (const [name, parse] of [['_headers', parseHeaders], ['_redirects', parseRedirects]]) {
  const f = join(root, name);
  if (!existsSync(f)) continue;
  const text = readFileSync(f, 'utf8');
  if (/^(<{7}|={7}|>{7})( |$)/m.test(text)) bad(name, 'contains merge-conflict markers.');
  for (const msg of parse(text).problems) bad(name, msg);
}

// llms.txt points agents at the site; every on-site link in it must exist.
const llms = join(root, 'llms.txt');
if (existsSync(llms)) {
  const text = readFileSync(llms, 'utf8');
  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  for (const href of new Set(links)) {
    const path = href.startsWith(siteUrl) ? href.slice(siteUrl.length) || '/' : href.startsWith('/') ? href : null;
    if (!path) continue;
    const clean = decodeURIComponent(path.split(/[?#]/)[0]);
    const candidates = clean.endsWith('/') ? [clean + 'index.html'] : [clean, clean + '.html', clean + '/index.html'];
    if (!candidates.some((c) => existsSync(join(root, c)) && statSync(join(root, c)).isFile())) bad('llms.txt', `links to ${href}, which the build does not emit.`);
  }
}

console.log(`Structure scan: ${pages.length} indexable page(s) in ${root}.`);
if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  console.log(`Structure scan: ${problems.length} problem(s).`);
  process.exit(1);
}
if (!pages.some((p) => /rel\s*=\s*["']?canonical/i.test(p.html))) warn('No page declares a canonical URL.');
console.log('Structure scan passed.');
