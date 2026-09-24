// Ship Gate edge test — what Cloudflare adds around the pages: redirects, headers,
// the 404 page and ignored files. The static server applies _redirects and
// _headers as Workers static assets does, so this tests the files that ship.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers';

const read = (f: string) => (existsSync(join(run.root, f)) ? readFileSync(join(run.root, f), 'utf8') : '');
const isStatic = (p: string) => !/\*|\/:[A-Za-z]/.test(p);

// Static rules only: splats and placeholders have no single URL to try.
const redirects = read('_redirects').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/\s+/)).filter((f) => f[0].startsWith('/') && isStatic(f[0]))
  .map(([from, to, status]) => ({ from, to, status: Number(status ?? 302) }));

test.describe('edge', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'HTTP-level checks run once.'));

  test('every _redirects rule answers with its status and Location', async ({ request }) => {
    test.skip(redirects.length === 0, 'No static rules in _redirects.');
    const wrong: string[] = [];
    for (const r of redirects.filter((r) => r.status !== 200)) {
      const res = await request.get(r.from, { maxRedirects: 0 });
      const loc = res.headers()['location'];
      if (res.status() !== r.status || loc !== r.to) wrong.push(`${r.from} → ${res.status()} ${loc ?? '(no Location)'}; expected ${r.status} ${r.to}`);
    }
    expect(wrong).toEqual([]);
  });

  test('every redirect destination on this site answers 200 (no chains, no dead ends)', async ({ request }) => {
    const targets = [...new Set(redirects.filter((r) => r.status !== 200 && r.to.startsWith('/') && isStatic(r.to)).map((r) => r.to.split(/[?#]/)[0]))];
    test.skip(targets.length === 0, 'No on-site redirect destinations.');
    const bad: string[] = [];
    for (const t of targets) {
      const res = await request.get(t, { maxRedirects: 0 });
      if (res.status() !== 200) bad.push(`${t} → ${res.status()} ${res.headers()['location'] ?? ''}`.trim());
    }
    expect(bad).toEqual([]);
  });

  test('security headers on the home page', async ({ request }) => {
    const h = (await request.get('/')).headers();
    const csp = h['content-security-policy'] ?? '';
    const missing = run.securityHeaders.filter((name) =>
      name === 'frame-protection' ? !h['x-frame-options'] && !/frame-ancestors/.test(csp) : !h[name]);
    expect(missing, 'Set these in public/_headers (frame-protection: X-Frame-Options or CSP frame-ancestors)').toEqual([]);
  });

  test('hashed assets are cached as immutable', async ({ request }) => {
    const dir = join(run.root, '_astro');
    const file = existsSync(dir) ? readdirSync(dir).find((f) => /\.(js|css)$/.test(f)) : undefined;
    test.skip(!file, 'No /_astro/ assets.');
    const cc = (await request.get(`/_astro/${file}`)).headers()['cache-control'] ?? '';
    expect(cc, 'Add to public/_headers:  /_astro/*\n  Cache-Control: public, max-age=31536000, immutable').toMatch(/immutable/);
  });

  test('unknown route answers 404 with the site\'s 404 page', async ({ request }) => {
    const res = await request.get('/this-page-should-not-exist-404');
    expect(res.status()).toBe(404);
    expect(existsSync(join(run.root, '404.html')), 'The build emits no 404.html (add src/pages/404.astro)').toBe(true);
  });

  test('.assetsignore files are not served', async ({ request }) => {
    const literal = read('.assetsignore').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !/[*?[\]!]/.test(l) && !l.endsWith('/') && existsSync(join(run.root, l)));
    test.skip(literal.length === 0, 'No literal .assetsignore entries present in the build.');
    const served: string[] = [];
    for (const f of literal) if ((await request.get('/' + f.replace(/^\//, ''))).status() !== 404) served.push(f);
    expect(served).toEqual([]);
  });
});
