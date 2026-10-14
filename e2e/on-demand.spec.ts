// Ship Gate on-demand test — pages the Worker renders on request ("server": "preview").
// The discovery scan reads the static build only, so a link to such a page is outside it
// (list its prefix in discovery.ignoreLinks). This test asks the served Worker instead: every
// internal link in the build whose target has no emitted file, and every page in `pages` with
// no emitted file, must answer 200 or redirect on this site (a gated page sends a visitor to
// onDemand.signInPath). A page that answers 200 names itself as canonical, and a noindex page
// is not in the sitemap. API routes (/api/) and the PostHog proxy (/ph/) are not pages.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { run } from './helpers';

const isFile = (f: string) => existsSync(f) && statSync(f).isFile();
const decode = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
const emitted = (p: string) => {
  const f = join(run.root, decode(p));
  // Without a trailing slash, Workers static assets also serves dir/index.html (after a redirect).
  return p.endsWith('/') ? isFile(join(f, 'index.html')) : isFile(f) || isFile(`${f}.html`) || isFile(join(f, 'index.html'));
};
const notAPage = (p: string) => /^\/(api|ph)(\/|$)/.test(p);

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) out.push(...htmlFiles(f));
    else if (name.endsWith('.html')) out.push(f);
  }
  return out;
}

function targets(): string[] {
  if (run.server !== 'preview') return [];
  const origin = new URL(run.siteUrl).origin;
  const found = new Set(run.pages.filter((p) => !emitted(p)));
  for (const f of htmlFiles(run.root)) {
    // A relative link resolves against the page it is on, as check-discovery.mjs does.
    const rel = relative(run.root, f).split(sep).join('/');
    const at = `/${rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
    for (const m of readFileSync(f, 'utf8').matchAll(/<a\b[^>]*\shref=["']([^"'#?]+)/gi)) {
      let p: string;
      try {
        const u = new URL(m[1].replace(/&amp;/g, '&'), `${origin}${at}`);
        if (u.origin !== origin) continue;
        p = u.pathname;
      } catch { continue; }
      if (!notAPage(p) && !emitted(p)) found.add(p);
    }
  }
  return [...found].filter((p) => !notAPage(p)).sort();
}

const sitemapPaths = () => {
  const paths = new Set<string>();
  for (const name of existsSync(run.root) ? readdirSync(run.root) : [])
    if (/^sitemap.*\.xml$/.test(name))
      for (const m of readFileSync(join(run.root, name), 'utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g))
        try { paths.add(new URL(m[1]).pathname); } catch { /* not a URL */ }
  return paths;
};

test.describe('on-demand pages', () => {
  test.beforeEach(({}, info) => {
    test.skip(run.server !== 'preview', 'Only "server": "preview" serves pages rendered on request.');
    test.skip(info.project.name !== 'desktop', 'HTTP-level checks run once.');
  });

  test('every on-demand link target and page answers 200 or redirects on this site', async ({ request, baseURL }) => {
    const list = targets();
    test.skip(list.length === 0, 'No links or pages outside the static build.');
    const signIn = run.onDemand?.signInPath ?? null;
    const inSitemap = sitemapPaths();
    const bad: string[] = [];
    const home = new URL(baseURL ?? 'http://localhost').origin;
    // Follows redirects on this site (at most five): a 301 to a missing page is a dead link, not a pass.
    const follow = async (start: string) => {
      let path = start;
      const hops: string[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request.get(path, { maxRedirects: 0 });
        const status = res.status();
        if (![301, 302, 303, 307, 308].includes(status)) return { res, path, hops, error: null };
        const loc = res.headers()['location'] ?? '';
        let to: URL | null = null;
        try { to = new URL(loc, `${home}${path}`); } catch { /* reported below */ }
        if (!to || to.origin !== home) return { res, path, hops, error: `${status} to another origin (${loc || 'no Location'})` };
        // A permanent redirect is a moved page; a temporary one must be the site's sign-in.
        if (![301, 308].includes(status) && to.pathname !== signIn)
          return { res, path, hops, error: `${status} ${to.pathname}; a gated page redirects to onDemand.signInPath (${signIn ?? 'not set'})` };
        hops.push(`${status} ${to.pathname}`);
        path = to.pathname + to.search;
      }
      return { res: null, path, hops, error: 'more than five redirects' };
    };
    for (const p of list) {
      const { res, path, hops, error } = await follow(p);
      const via = hops.length ? ` (via ${hops.join(' → ')})` : '';
      if (error || !res) { bad.push(`${p} → ${error}${via}`); continue; }
      if (res.status() !== 200) { bad.push(`${p} → ${res.status()}${via}`); continue; }
      const html = await res.text();
      const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
      const here = path.split('?')[0];
      if (canonical && new URL(canonical, run.siteUrl).pathname !== here) bad.push(`${p}${via}: canonical points at ${canonical}`);
      if (!canonical) bad.push(`${p}${via}: no canonical`);
      const noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html) || /noindex/i.test(res.headers()['x-robots-tag'] ?? '');
      if (noindex && inSitemap.has(here)) bad.push(`${p}${via}: noindex, but listed in the sitemap`);
    }
    expect(bad).toEqual([]);
  });
});
