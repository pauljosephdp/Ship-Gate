#!/usr/bin/env node
// Ship Gate static server: serves the built site for Playwright, Lighthouse and
// served site checks, the way Cloudflare Workers static assets would.
//
//   node serve-static.mjs <distDir> <port>
//
// Follows Workers static-assets behaviour, so the gate tests what production serves:
//   • _redirects first (static and splat/placeholder rules; 200 rewrites in place)
//   • html_handling "auto-trailing-slash": /about/ serves about/index.html,
//     /about redirects (307) to /about/, /post serves post.html, /post.html → /post
//   • _headers applied to every asset response (globs, placeholders, "! Name" removals)
//   • .assetsignore files, _headers, _redirects and _worker.js are never served
//   • unknown paths answer 404 with the site's 404.html when it has one
// No wrangler: some site wrangler configs run remote migrations on start.
// No dependencies: Node built-ins only.

import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { join, resolve, extname, sep, relative } from 'node:path';
import { staticRoot, assetsIgnore, parseHeaders, parseRedirects, compilePattern, substitute } from './site-files.mjs';

const [dist = 'dist', port = '4321'] = process.argv.slice(2);
const ROOT = resolve(staticRoot(dist));
if (!existsSync(ROOT)) {
  console.error(`serve-static: ${ROOT} not found — run the build first.`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};

const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const headerRules = parseHeaders(read('_headers')).rules.map((r) => ({ ...r, match: compilePattern(r.pattern) }));
const redirectRules = parseRedirects(read('_redirects')).rules.map((r) => ({ ...r, match: compilePattern(r.from) }));
const { ignored } = assetsIgnore(ROOT);

// An asset that exists and would be uploaded, or null.
function asset(p) {
  const abs = resolve(ROOT, '.' + p);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null; // no escaping the build directory
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return ignored(relative(ROOT, abs).split(sep).join('/')) ? null : abs;
}

// Workers auto-trailing-slash. Returns { file } or { redirect } or null.
function resolveHtml(p) {
  if (p.endsWith('/index.html')) return asset(p) ? { redirect: p.slice(0, -'index.html'.length) } : null;
  if (p.endsWith('.html')) return asset(p) ? { redirect: p.slice(0, -'.html'.length) } : null;
  if (p.endsWith('/')) {
    const idx = asset(p + 'index.html');
    if (idx) return { file: idx };
    if (p !== '/' && asset(p.slice(0, -1) + '.html')) return { redirect: p.slice(0, -1) };
    return null;
  }
  const exact = asset(p);
  if (exact) return { file: exact };
  const html = asset(p + '.html');
  if (html) return { file: html };
  if (asset(p + '/index.html')) return { redirect: p + '/' };
  return null;
}

function headersFor(p) {
  const out = new Map();
  for (const r of headerRules) {
    if (!r.match(p)) continue;
    for (const name of r.unset) out.delete(name);
    for (const [name, value] of r.set) out.set(name, out.has(name) ? `${out.get(name)}, ${value}` : value);
  }
  return Object.fromEntries(out);
}

const notFoundFile = asset('/404.html');

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = null; }
  const send = (status, file, extra = {}) => {
    const type = file ? TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' : 'text/plain; charset=utf-8';
    res.writeHead(status, { 'content-type': type, ...headersFor(url.pathname), ...extra });
    if (req.method === 'HEAD' || !file) return res.end(file ? undefined : 'Not found');
    createReadStream(file).pipe(res);
  };
  if (path === null) return send(400, null);

  for (const r of redirectRules) {
    const params = r.match(url.pathname);
    if (!params) continue;
    const to = substitute(r.to, params);
    if (r.status === 200 && to.startsWith('/')) { path = decodeURIComponent(to.split(/[?#]/)[0]); break; }
    res.writeHead(r.status, { location: to });
    return res.end();
  }

  const hit = resolveHtml(path);
  if (hit?.redirect) {
    res.writeHead(307, { location: hit.redirect + url.search });
    return res.end();
  }
  if (hit?.file) return send(200, hit.file);
  return send(404, notFoundFile);
}).listen(Number(port), () => console.log(`Ship Gate serving ${ROOT} on http://localhost:${port}`));
