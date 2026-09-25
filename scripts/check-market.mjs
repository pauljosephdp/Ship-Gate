#!/usr/bin/env node
// Ship Gate market scan: the market-cn and rtl-logical-css policies, run on the built output.
//
//   node check-market.mjs        (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// market-cn: no page, stylesheet or script loads a resource from a host that mainland China
//   blocks (Google, YouTube, Facebook, Instagram, X/Twitter, Vimeo, Gravatar). A blocked font or
//   script stalls rendering until it times out. Links to those sites are fine: they load nothing.
//   URLs with non-ASCII characters warn: they break when shared through Chinese platforms.
//   Guard "blocked-in-cn" may be exempted with a reason and date.
// rtl-logical-css: counts left/right physical properties in the built CSS. They do not mirror
//   under dir="rtl" the way margin-inline-start and friends do. Warns only: some are correct.
// No dependencies: Node built-ins only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { htmlFiles, assetsIgnore } from './site-files.mjs';

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
  const BLOCKED = /\/\/(?:[a-z0-9-]+\.)*(google\.com|googleapis\.com|gstatic\.com|googletagmanager\.com|google-analytics\.com|doubleclick\.net|googlesyndication\.com|youtube\.com|youtube-nocookie\.com|ytimg\.com|youtu\.be|facebook\.com|facebook\.net|fbcdn\.net|instagram\.com|cdninstagram\.com|twitter\.com|x\.com|twimg\.com|vimeo\.com|vimeocdn\.com|gravatar\.com)(?=[/:"'?#\s)]|$)/gi;
  // Public CDNs that are unreliable from the mainland: warn, don't fail.
  const SLOW = /\/\/(cdn\.jsdelivr\.net|unpkg\.com)(?=[/"'?#\s)]|$)/gi;
  // In HTML, only what the browser loads: links, social meta and JSON-LD sameAs load nothing.
  const loaded = (html) => html
    .replace(/<a\b[^>]*>/gi, ' ')
    .replace(/<meta\b[^>]*>/gi, ' ')
    .replace(/<link\b(?=[^>]*\brel\s*=\s*["']?(canonical|alternate|me|author|license)\b)[^>]*>/gi, ' ')
    .replace(/<script\b[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const hits = new Map(), slow = new Map();
  for (const f of files(/\.(html|css|m?js)$/i)) {
    let text = readFileSync(f.file, 'utf8');
    if (/\.html$/i.test(f.rel)) text = loaded(text);
    for (const m of text.matchAll(BLOCKED)) hits.set(f.rel, new Set([...(hits.get(f.rel) ?? []), m[1].toLowerCase()]));
    for (const m of text.matchAll(SLOW)) slow.set(f.rel, new Set([...(slow.get(f.rel) ?? []), m[1].toLowerCase()]));
  }
  const level = exempt.includes('blocked-in-cn') ? 'warning' : 'error';
  for (const [rel, hosts] of hits)
    console.log(`::${level}::${level === 'warning' ? '[exempt: blocked-in-cn] ' : ''}${rel} loads from ${[...hosts].join(', ')}, blocked in mainland China. Self-host the font or script, or use a provider that serves China.`);
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
