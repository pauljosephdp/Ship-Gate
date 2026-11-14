#!/usr/bin/env node
// Ship Gate market scan: the market-cn and rtl-logical-css policies, run on the built output.
//
//   node check-market.mjs        (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// market-cn: no page, stylesheet or script loads a resource from a host that mainland China
//   blocks (chinaBlockedHosts in standards/standards.json: Google, YouTube, Meta, X, LinkedIn,
//   Vimeo, Gravatar and others; the list website-audit reads too). A blocked font or
//   script stalls rendering until it times out. Links to those sites are fine: they load nothing.
//   A blocked URL in script that is not visibly loaded warns (a share link reads the same).
//   URLs with non-ASCII characters warn: they break when shared through Chinese platforms.
//   Guard "blocked-in-cn" may be exempted with a reason and date.
// rtl-logical-css: counts left/right physical properties in the built CSS. They do not mirror
//   under dir="rtl" the way margin-inline-start and friends do. Warns only: some are correct.
// No dependencies: Node built-ins only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { htmlFiles, assetsIgnore } from './site-files.mjs';
import { CHINA_BLOCKED, CHINA_UNRELIABLE, hostPattern } from './standards.mjs';

const OUT = process.env.SHIP_GATE_DIR || '.ship-gate';
const { root, policies = [], exempt = [] } = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));
const { ignored } = assetsIgnore(root);

// Every served file with one of these extensions.
function files(exts) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(root, p).split(sep).join('/');
      if (statSync(p).isDirectory()) { if (!(d === root && name === '_worker.js')) walk(p); continue; }
      if (exts.test(name) && !ignored(rel)) out.push({ file: p, rel });
    }
  };
  walk(root);
  return out;
}

let failed = false;

if (policies.includes('market-cn')) {
  // Hosts blocked by the Great Firewall. A "//" must precede the host, so only URLs match.
  const BLOCKED = new RegExp(hostPattern(CHINA_BLOCKED), 'gi');
  // Public CDNs that are unreliable from the mainland: warn, don't fail.
  const SLOW = new RegExp(hostPattern(CHINA_UNRELIABLE), 'gi');
  // Only what the browser loads is a resource. A link (<a href>, a share URL, JSON-LD sameAs, social
  // meta) loads nothing. In HTML: the URL attributes of loading elements, CSS in <style> and style="",
  // and script. In CSS: @import and url(). In script (inline or a bundle) a link can't be told from a
  // load by its text, so a URL passed to fetch(), import(), importScripts(), sendBeacon(), new Worker()
  // or EventSource, or assigned to .src, is a resource; any other blocked URL in script warns.
  const LOADING = /<(script|img|source|iframe|video|audio|embed|object|input|track)\b[^>]*>/gi;
  const LINK_LOADS = /\brel\s*=\s*["']?[^"'>]*\b(stylesheet|preload|modulepreload|icon|apple-touch-icon|manifest|prefetch)\b/i;
  const LOAD_CALL = /(?:\b(?:fetch|import|importScripts|sendBeacon|Worker|EventSource)\s*\(\s*|\.src\s*=\s*)["'`](?:https?:)?$/;
  // A static import or re-export is a load too: import x from "url", import "url", export { x } from "url".
  const STATIC_IMPORT = /(?:\bimport\s*(?:[\w$*{},\s]+?\s*from\s*)?|\bexport\s*[\w$*{},\s]+?\s*from\s*)["'`](?:https?:)?$/;
  // In a hand-written inline <script>, a blocked URL is a load (loader snippets pass it as an argument),
  // unless it sits in a link context: window.open(), an href or location, or a share URL.
  const LINK_CONTEXT = /(?:\bopen\s*\(\s*|\bhref\s*[=:]\s*|\bsetAttribute\s*\(\s*["']href["']\s*,\s*|\blocation(?:\.href)?\s*=\s*|share[\w.]*\s*[=:(]\s*)["'`](?:https?:)?$/i;
  // Share and follow URLs are links whatever the variable is called.
  const LINK_URL = /^(?:https?:)?\/\/[^\s"'`]*(?:\/intent\/|sharer|share-offsite|\/share\b|\/shareArticle)/i;
  const attrUrls = (tag) => [...tag.matchAll(/\b(src|srcset|href|poster|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => m[3] ?? m[4] ?? m[5] ?? '');
  const cssLoads = (css) => [...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)|url\(\s*["']?([^"')\s]+)/gi)].map((m) => m[1] ?? m[2]).join(' ');
  // Returns { sure: text of URLs the page loads, maybe: script text whose URLs may be links }.
  function resources(text, rel) {
    if (/\.css$/i.test(rel)) return { sure: cssLoads(text), maybe: '' };
    if (/\.m?js$/i.test(rel)) return scriptLoads(text);
    const html = text.replace(/<!--[\s\S]*?-->/g, ' ');
    let sure = [...html.matchAll(LOADING)].flatMap((m) => attrUrls(m[0])).join(' ');
    sure += ' ' + [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => LINK_LOADS.test(t)).flatMap(attrUrls).join(' ');
    sure += ' ' + cssLoads([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? m[2]).join('\n'));
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/application\/(ld\+)?json/i.test(m[1])).map((m) => scriptLoads(m[2], true));
    return { sure: [sure, ...inline.map((x) => x.sure)].join(' '), maybe: inline.map((x) => x.maybe).join(' ') };
  }
  function scriptLoads(js, inline = false) {
    const sure = [], maybe = [];
    for (const m of js.matchAll(new RegExp(hostPattern([...CHINA_BLOCKED, ...CHINA_UNRELIABLE]), 'gi'))) {
      const near = js.slice(Math.max(0, m.index - 40), m.index), wide = js.slice(Math.max(0, m.index - 300), m.index);
      const load = LOAD_CALL.test(near) || STATIC_IMPORT.test(wide)
        || (inline && !LINK_CONTEXT.test(near) && !LINK_URL.test(js.slice(m.index, m.index + 200)));
      (load ? sure : maybe).push(m[0]);
    }
    return { sure: sure.join(' '), maybe: maybe.join(' ') };
  }
  const hits = new Map(), slow = new Map(), unsure = new Map();
  const note = (map, rel, host) => map.set(rel, new Set([...(map.get(rel) ?? []), host.toLowerCase()]));
  for (const f of files(/\.(html|css|m?js)$/i)) {
    const { sure, maybe } = resources(readFileSync(f.file, 'utf8'), f.rel);
    for (const m of sure.matchAll(BLOCKED)) note(hits, f.rel, m[1]);
    for (const m of sure.matchAll(SLOW)) note(slow, f.rel, m[1]);
    for (const m of maybe.matchAll(BLOCKED)) note(unsure, f.rel, m[1]);
  }
  const level = exempt.includes('blocked-in-cn') ? 'warning' : 'error';
  for (const [rel, hosts] of hits)
    console.log(`::${level}::${level === 'warning' ? '[exempt: blocked-in-cn] ' : ''}${rel} loads from ${[...hosts].join(', ')}, blocked in mainland China. Self-host the font or script, or use a provider that serves China.`);
  for (const [rel, hosts] of unsure)
    console.log(`::warning::${rel} names ${[...hosts].join(', ')} (blocked in mainland China) in script. If it loads from there, rather than linking to it, self-host it.`);
  for (const [rel, hosts] of slow) console.log(`::warning::${rel} loads from ${[...hosts].join(', ')}, which is unreliable from mainland China. Self-host it.`);
  const nonAscii = htmlFiles(root).map((p) => p.path).filter((p) => /[^\x20-\x7e]/.test(p));
  if (nonAscii.length) console.log(`::warning::${nonAscii.length} URL(s) contain non-ASCII characters (${nonAscii.slice(0, 3).join(', ')}). Use Pinyin, English or numbers: encoded Chinese characters break when URLs are shared.`);
  if (hits.size && level === 'error') failed = true;
  console.log(`market-cn: ${hits.size} file(s) load blocked resources.`);
}

if (policies.includes('rtl-logical-css')) {
  const PHYSICAL = [
    [/(?<![\w-])(?:margin|padding)-(?:left|right)\s*:/g, 'margin/padding-left/right → margin/padding-inline-start/end'],
    [/(?<![\w-])border-(?:left|right)(?:-(?:width|style|color))?\s*:/g, 'border-left/right → border-inline-start/end'],
    [/(?<![\w-])(?:left|right)\s*:/g, 'left/right → inset-inline-start/end'],
    [/(?<![\w-])text-align\s*:\s*(?:left|right)\b/g, 'text-align: left/right → start/end'],
    [/(?<![\w-])(?:float|clear)\s*:\s*(?:left|right)\b/g, 'float/clear: left/right → inline-start/end'],
  ];
  const counts = [];
  let total = 0;
  const byKind = new Map();
  for (const f of files(/\.(css|html)$/i)) {
    let css = readFileSync(f.file, 'utf8');
    if (/\.html$/i.test(f.rel)) css = [...css.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? m[2]).join('\n');
    let n = 0;
    for (const [re, hint] of PHYSICAL) {
      const k = (css.match(re) ?? []).length;
      if (k) { n += k; byKind.set(hint, (byKind.get(hint) ?? 0) + k); }
    }
    if (n) { counts.push([f.rel, n]); total += n; }
  }
  if (total) {
    counts.sort((a, b) => b[1] - a[1]);
    console.log(`::warning::${total} physical left/right CSS declaration(s) won't mirror under dir="rtl". Most in: ${counts.slice(0, 3).map(([r, n]) => `${r} (${n})`).join(', ')}. Replace: ${[...byKind.keys()].join('; ')}.`);
  }
  console.log(`rtl-logical-css: ${total} physical declaration(s).`);
}

if (failed) process.exit(1);
console.log('Market scan passed.');
