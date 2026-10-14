// Ship Gate on-demand test — pages the Worker renders on request ("server": "preview").
// The discovery scan reads the static build only, so a link to such a page is outside it
// (list its prefix in discovery.ignoreLinks). This test asks the served Worker instead: every
// internal link in the build whose target has no emitted file, and every page in `pages` with
// no emitted file, must answer 200 or redirect on this site (a gated page sends a visitor to
// onDemand.signInPath). A page that answers 200 names itself as canonical, and a noindex page
// is not in the sitemap. API routes (/api/) and the PostHog proxy (/ph/) are not pages.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './helpers';

const emitted = (p: string) => {
  const f = join(run.root, decodeURIComponent(p));
  return (p.endsWith('/') ? existsSync(join(f, 'index.html')) : existsSync(f) || existsSync(`${f}.html`));
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
    for (const m of readFileSync(f, 'utf8').matchAll(/<a\b[^>]*\shref=["']([^"'#?]+)/gi)) {
      let p: string;
      try { const u = new URL(m[1], `${origin}/`); if (u.origin !== origin) continue; p = u.pathname; } catch { continue; }
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
    for (const p of list) {
      const res = await request.get(p, { maxRedirects: 0 });
      const status = res.status();
      if ([301, 302, 303, 307, 308].includes(status)) {
        const loc = res.headers()['location'] ?? '';
        let to: URL | null = null;
        try { to = new URL(loc, baseURL); } catch { /* reported below */ }
        if (!to || to.origin !== new URL(baseURL ?? 'http://localhost').origin) bad.push(`${p} → ${status} to another origin (${loc || 'no Location'})`);
        // A permanent redirect is a moved page; a temporary one must be the site's sign-in.
        else if (![301, 308].includes(status) && to.pathname !== signIn)
          bad.push(`${p} → ${status} ${to.pathname}; a gated page redirects to onDemand.signInPath (${signIn ?? 'not set'})`);
        continue;
      }
      if (status !== 200) { bad.push(`${p} → ${status}`); continue; }
      const html = await res.text();
      const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
      if (canonical && new URL(canonical, run.siteUrl).pathname !== p) bad.push(`${p}: canonical points at ${canonical}`);
      if (!canonical) bad.push(`${p}: no canonical`);
      const noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html) || /noindex/i.test(res.headers()['x-robots-tag'] ?? '');
      if (noindex && inSitemap.has(p)) bad.push(`${p}: noindex, but listed in the sitemap`);
    }
    expect(bad).toEqual([]);
  });
});
