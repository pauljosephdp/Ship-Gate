#!/usr/bin/env node
// Ship Gate PostHog scan (posthog-hybrid policy) — after the build, on what the browser gets.
//
//   node check-posthog.mjs     (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// • Every indexable page initialises PostHog: the project key reaches the page, inline
//   (the snippet embed) or in a same-origin script the page loads (the npm embed). CI builds
//   with Ship Gate's test key, so its presence proves the component rendered.
// • No personal API key (phx_) anywhere in client output, and no project key other than
//   the test key: a different one was hard-coded, or leaked into CI from somewhere else.
// • Every Content-Security-Policy that applies to a page (from _headers or a <meta> tag,
//   enforced or Report-Only) lets PostHog load, send and record: its assets host in
//   script-src, its API host in connect-src, blob: workers for session replay, and for the
//   snippet embed 'unsafe-inline'. The snippet's text holds the project key, so no one hash
//   covers both CI's test key and production's key. The browser tests abort
//   PostHog's requests, so lazily loaded replay and survey code would never trip CSP there.
// A dated guardExemptions entry for posthog-missing or posthog-csp turns those into warnings.
// No dependencies: Node built-ins only.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { indexablePages, parseHeaders, compilePattern, metaTags, attr } from './site-files.mjs';

const OUT = process.env.SHIP_GATE_DIR || '.ship-gate';
const { root, posthog, exempt = [] } = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));
if (!posthog) { console.log('posthog-hybrid is off: nothing to check.'); process.exit(0); }

const errors = [];
const warnings = [];
const fail = (guard, msg) => (exempt.includes(guard) ? warnings.push(`[exempt: ${guard}] ${msg}`) : errors.push(msg));

// ── Keys in anything the browser downloads ──
const KEY = /ph[cx]_[A-Za-z0-9]{20,}/g;
const clientFiles = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) { if (!(d === root && name === '_worker.js')) walk(p); continue; }
    if (/\.(m?js|html)$/.test(name)) clientFiles.push(p);
  }
};
walk(root);
for (const f of clientFiles) {
  for (const k of new Set(readFileSync(f, 'utf8').match(KEY) ?? [])) {
    const rel = relative(root, f).split(sep).join('/');
    if (k.startsWith('phx_')) errors.push(`${rel}: a PostHog personal API key (phx_…) is in client output. Rotate it now; personal keys never leave the server.`);
    else if (k !== posthog.testKey) errors.push(`${rel}: a PostHog project key other than Ship Gate's CI key is in client output — it is hard-coded, or set in CI. Read it from PUBLIC_POSTHOG_KEY.`);
  }
}

// ── The key on every page ──
// A page's same-origin scripts, and the modules they import, as text.
const scriptCache = new Map();
function scriptText(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return '';
  seen.add(file);
  if (!scriptCache.has(file)) scriptCache.set(file, readFileSync(file, 'utf8'));
  const text = scriptCache.get(file);
  let all = text;
  for (const m of text.matchAll(/(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?["']([^"']+\.m?js)["']|import\(\s*["']([^"']+\.m?js)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    const next = spec.startsWith('/') ? join(root, spec) : resolve(dirname(file), spec);
    all += '\n' + scriptText(next, seen);
  }
  return all;
}
const inlineScripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, a]) => !/\bsrc\s*=/i.test(a) && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(a))
  .map(([, , body]) => body);
const pageScripts = (p) => [...p.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)]
  .map((m) => m[1] ?? m[2] ?? m[3])
  .filter((src) => src.startsWith('/') && !src.startsWith('//'))
  .map((src) => scriptText(join(root, src.split(/[?#]/)[0])))
  .join('\n');

const pages = indexablePages(root);
const missing = [];
const snippetPages = new Set(); // pages that start PostHog from an inline script
for (const p of pages) {
  if (inlineScripts(p.html).some((s) => s.includes(posthog.testKey))) snippetPages.add(p.path);
  else if (!pageScripts(p).includes(posthog.testKey)) missing.push(p.path);
}
if (missing.length) {
  fail('posthog-missing', `PostHog does not initialise on ${missing.length} of ${pages.length} page(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}. ` +
    'Render the PostHog component (templates/caller/posthog) in the <head> of every layout.');
}
if (posthog.embed === 'npm' && snippetPages.size)
  warnings.push(`posthog.embed is "npm", but ${snippetPages.size} page(s) initialise PostHog in an inline script. Set posthog.embed to "snippet" if that is the embed in use.`);

// ── CSP lets PostHog work ──
const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
const headerRules = parseHeaders(read('_headers')).rules.map((r) => ({ ...r, match: compilePattern(r.pattern) }));
function headerCsps(path) {
  const out = new Map();
  for (const r of headerRules) {
    if (!r.match(path)) continue;
    for (const name of r.unset) out.delete(name);
    for (const [name, value] of r.set) out.set(name, [...(out.get(name) ?? []), value]);
  }
  return ['content-security-policy', 'content-security-policy-report-only'].flatMap((h) => out.get(h) ?? []);
}
const directives = (policy) => Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0])
  .map(([name, ...values]) => [name.toLowerCase(), values]));
// The sources a fetch directive falls back to, as browsers resolve them.
const FALLBACK = {
  'script-src-elem': ['script-src-elem', 'script-src', 'default-src'],
  'connect-src': ['connect-src', 'default-src'],
  'worker-src': ['worker-src', 'child-src', 'script-src', 'default-src'],
};
const sources = (d, directive) => {
  for (const name of FALLBACK[directive]) if (d[name]) return d[name];
  return null; // not restricted
};
const allows = (list, origin) => {
  if (list === null) return true;
  if (origin === "'self'") return list.includes("'self'");
  if (origin === 'blob:') return list.includes('blob:'); // '*' never matches blob:
  const host = new URL(origin).hostname;
  return list.some((s) => {
    const src = s.replace(/^'|'$/g, '');
    if (s === '*' || s === 'https:') return true;
    const m = src.match(/^(?:https:\/\/)?(\*\.)?([^/:]+)(?::\d+)?\/?$/i);
    if (!m) return false;
    return m[1] ? host.endsWith(`.${m[2]}`) : host === m[2].toLowerCase();
  });
};
const proxied = posthog.apiHost.startsWith('/');
const api = proxied ? "'self'" : posthog.apiHost;
const assets = proxied ? "'self'" : posthog.assetsHost;
const cspProblems = new Map(); // problem → pages
for (const p of pages) {
  const metaCsp = metaTags(p.html)
    .filter((t) => (attr(t, 'http-equiv') ?? '').toLowerCase() === 'content-security-policy')
    .map((t) => attr(t, 'content') ?? '');
  for (const policy of [...headerCsps(p.path), ...metaCsp]) {
    const d = directives(policy);
    const need = [];
    if (!allows(sources(d, 'script-src-elem'), assets)) need.push(`script-src ${assets}`);
    if (!allows(sources(d, 'connect-src'), api)) need.push(`connect-src ${api}`);
    if (!proxied && !allows(sources(d, 'connect-src'), assets)) need.push(`connect-src ${assets}`);
    if (!allows(sources(d, 'worker-src'), 'blob:')) need.push('worker-src blob:');
    // Browsers ignore 'unsafe-inline' once a hash or nonce is listed. A nonce is added per
    // response by a Worker, out of the build's sight, so it passes with a warning.
    const scriptSrc = sources(d, 'script-src-elem');
    if (snippetPages.has(p.path) && scriptSrc !== null) {
      if (scriptSrc.some((s) => s.startsWith("'nonce-"))) warnings.push(`${p.path}: script-src uses a nonce; make sure the Worker puts it on the PostHog snippet.`);
      else if (!scriptSrc.includes("'unsafe-inline'") || scriptSrc.some((s) => /^'sha(256|384|512)-/.test(s)))
        need.push("script-src 'unsafe-inline' without hashes (the snippet embed is an inline script holding the key; with a strict CSP use the npm embed)");
    }
    for (const n of need) cspProblems.set(n, [...(cspProblems.get(n) ?? []), p.path]);
  }
}
for (const [need, where] of cspProblems)
  fail('posthog-csp', `Content-Security-Policy blocks PostHog: add ${need} (on ${where.slice(0, 5).join(', ')}${where.length > 5 ? ', …' : ''}). See templates/caller/posthog/csp.txt.`);

for (const w of warnings) console.log(`::warning::${w}`);
console.log(`PostHog scan: ${pages.length} page(s), ${posthog.embed} embed, API ${posthog.apiHost}, cookieless ${posthog.cookieless}.`);
if (errors.length) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}
console.log('PostHog initialises on every page, and nothing blocks it.');
