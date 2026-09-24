// Ship Gate — reading a built site the way Cloudflare Workers static assets serves it.
// Shared by prepare.mjs, serve-static.mjs, check-structure.mjs and check-copy.mjs.
// No dependencies: Node built-ins only.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// The Cloudflare adapter emits dist/client (assets) + dist/server (Worker);
// a plain static build emits dist.
export function staticRoot(distDir) {
  const client = join(distDir, 'client');
  return existsSync(join(distDir, 'index.html')) || !existsSync(client) ? distDir : client;
}

// Files Cloudflare never serves as assets.
const CONTROL_FILES = new Set(['_headers', '_redirects', '_routes.json', '.assetsignore']);

// .assetsignore: gitignore-style lines; files that match are not uploaded, so they 404.
export function assetsIgnore(root) {
  const f = join(root, '.assetsignore');
  const rules = existsSync(f)
    ? readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  const res = rules.map((r) => {
    const anchored = r.startsWith('/');
    const body = r.replace(/^\//, '').replace(/\/$/, '/**');
    const re = body.split('**').map((part) => part.split('*').map(escapeRe).join('[^/]*')).join('.*');
    return new RegExp(anchored || body.includes('/') ? `^${re}$` : `(^|/)${re}(/|$)`);
  });
  return { rules, ignored: (rel) => CONTROL_FILES.has(rel) || rel.startsWith('_worker.js') || res.some((r) => r.test(rel)) };
}

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every .html file the build emits, as { file, rel, path }. The static root never
// holds the Worker (dist/server sits beside dist/client), so only a legacy
// _worker.js directory at the root is skipped; a content folder named "server" counts.
export function htmlFiles(root) {
  const { ignored } = assetsIgnore(root);
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(root, p).split(sep).join('/');
      if (statSync(p).isDirectory()) {
        if (d === root && name === '_worker.js') continue;
        walk(p);
        continue;
      }
      if (!name.endsWith('.html') || ignored(rel)) continue;
      out.push({ file: p, rel, path: '/' + rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '') });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined);
export const metaTags = (html) => [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
export const metaContent = (html, name) => {
  const tag = metaTags(html).find((t) => (attr(t, 'name') ?? '').toLowerCase() === name);
  return tag === undefined ? undefined : (attr(tag, 'content') ?? '');
};
export { attr };

// A page is worth testing as a page unless it is the 404 page, opts out of
// indexing, is a meta-refresh redirect stub, or is a search-console verification file.
export function pageKind(rel, html) {
  if (/^404(\.html|\/index\.html)$/.test(rel)) return '404';
  if (/^google[0-9a-f]+\.html$/.test(rel) || /^BingSiteAuth/.test(rel) || /^yandex_[0-9a-f]+\.html$/.test(rel)) return 'verification';
  if (metaTags(html).some((t) => /http-equiv\s*=\s*["']?refresh/i.test(t))) return 'redirect';
  if (/noindex/i.test(metaContent(html, 'robots') ?? '')) return 'noindex';
  return 'page';
}

export function indexablePages(root) {
  return htmlFiles(root)
    .map((p) => ({ ...p, html: readFileSync(p.file, 'utf8') }))
    .filter((p) => pageKind(p.rel, p.html) === 'page');
}

// _headers: a URL pattern line, then indented "Name: value" or "! Name" lines.
// Returns { rules: [{ pattern, set: [[name, value]], unset: [name] }], problems: [msg] }.
export function parseHeaders(text) {
  const rules = [];
  const problems = [];
  let cur = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (/^\s/.test(line)) {
      if (!cur) { problems.push(`line ${n}: header before any URL pattern`); return; }
      const t = line.trim();
      if (t.startsWith('!')) { cur.unset.push(t.slice(1).trim().toLowerCase()); return; }
      const m = t.match(/^([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s*(.*)$/);
      if (!m) { problems.push(`line ${n}: "${t}" is not "Name: value"`); return; }
      cur.set.push([m[1].toLowerCase(), m[2]]);
      return;
    }
    const pattern = line.trim();
    if (!/^(\/|https?:\/\/)/.test(pattern)) { problems.push(`line ${n}: "${pattern}" is not a URL pattern (start with / or https://)`); return; }
    cur = { pattern, set: [], unset: [] };
    rules.push(cur);
  });
  return { rules, problems };
}

// _redirects: "source destination [status]". Default status 302.
export const REDIRECT_CODES = [200, 301, 302, 303, 307, 308];
export function parseRedirects(text) {
  const rules = [];
  const problems = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const f = t.split(/\s+/);
    if (f.length < 2 || f.length > 3) { problems.push(`line ${i + 1}: "${t}" needs "source destination [status]"`); return; }
    const status = f[2] === undefined ? 302 : Number(f[2]);
    if (!REDIRECT_CODES.includes(status)) { problems.push(`line ${i + 1}: status ${f[2]} is not one of ${REDIRECT_CODES.join(', ')}`); return; }
    if (!/^(\/|https?:\/\/)/.test(f[0])) { problems.push(`line ${i + 1}: source "${f[0]}" must start with / or https://`); return; }
    rules.push({ from: f[0], to: f[1], status, line: i + 1 });
  });
  return { rules, problems };
}

// Cloudflare URL patterns: "*" is a greedy splat, ":name" a path segment placeholder.
// A pattern with a host (https://host/path) matches on its path here — there is one host in the gate.
export function compilePattern(pattern) {
  const path = pattern.replace(/^https?:\/\/[^/]+/, '') || '/';
  const names = [];
  const re = path.split(/(\*|:[A-Za-z]\w*)/).map((part) => {
    if (part === '*') { names.push('splat'); return '(.*)'; }
    if (/^:[A-Za-z]\w*$/.test(part)) { names.push(part.slice(1)); return '([^/]+)'; }
    return escapeRe(part);
  }).join('');
  const rx = new RegExp(`^${re}$`);
  return (p) => {
    const m = p.match(rx);
    if (!m) return null;
    const params = {};
    names.forEach((n, i) => { params[n] = m[i + 1]; });
    return params;
  };
}

export const substitute = (to, params) => to.replace(/:([A-Za-z]\w*)/g, (s, n) => (n in params ? params[n] : s));
export const isStaticPattern = (p) => !/[*]|\/:[A-Za-z]/.test(p);
