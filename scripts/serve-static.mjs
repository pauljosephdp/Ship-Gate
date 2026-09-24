#!/usr/bin/env node
// Ship Gate static server: serves the built site for Playwright and Lighthouse.
//
//   node serve-static.mjs <distDir> <port>
//
// Used when ship-gate.config.json has "server": "static" (the default), so the
// gate does not depend on `astro preview` working under the Cloudflare adapter.
// The Cloudflare adapter emits dist/client; a plain static build emits dist.
// /about/ → about/index.html, /about → about.html or about/index.html.
// Unknown paths answer 404 with the site's 404.html when it has one.
// No dependencies: Node built-ins only.

import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';

const [dist = 'dist', port = '4321'] = process.argv.slice(2);
const client = join(dist, 'client');
const ROOT = resolve(existsSync(join(dist, 'index.html')) || !existsSync(client) ? dist : client);
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

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function locate(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const abs = resolve(ROOT, '.' + p);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null; // no escaping the build directory
  if (p.endsWith('/')) return isFile(join(abs, 'index.html')) ? join(abs, 'index.html') : null;
  if (isFile(abs)) return abs;
  if (isFile(abs + '.html')) return abs + '.html';
  if (isFile(join(abs, 'index.html'))) return join(abs, 'index.html');
  return null;
}

const notFound = isFile(join(ROOT, '404.html')) ? readFileSync(join(ROOT, '404.html')) : Buffer.from('Not found');

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = locate(path);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : notFound);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(Number(port), () => console.log(`Ship Gate serving ${ROOT} on http://localhost:${port}`));
