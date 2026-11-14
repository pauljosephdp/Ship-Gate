// Ship Gate render test — the discovery rules that need the served build in a browser. They came
// from website-audit (pauljosephdp/Skills) on 2026-11-14: anything the build served on localhost can
// prove is Ship Gate's, so website-audit reads these results instead of re-testing them.
// - rendered-content: the no-JS ratio. Words and links in the page with JavaScript off, against the
//   rendered page. Crawlers for AI answers mostly do not run JavaScript (Googlebot does; Bingbot less
//   reliably; Baiduspider and Naver's Yeti much less), so content that exists only after script runs is
//   invisible to them. Thresholds: buildChecks.renderedContent in standards/standards.json.
// - lazy-first-viewport: an <img loading="lazy"> in the first viewport, on desktop or mobile, delays
//   the very paint it appears to help (often the LCP image).
// - content-parity: a content block visible on desktop has no visible match on mobile (removed, not
//   reflowed). Mobile-first indexing reads the mobile page. Navigation, header, footer and asides are
//   left out, and so is progressive disclosure (aria-expanded, <details>, accordions).
// - first-party-only (policy): every page the sitemap lists loads nothing from another origin, apart
//   from allowedOrigins.
// Levels come from the site's discovery levels (run.json), so discoveryOverrides apply. Each page
// writes reports/render/<page>.json for results.json. Desktop project only: it opens its own
// JavaScript-off and Pixel 7 contexts.
import { test, expect, devices, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, sameOriginOnly, settle } from './helpers';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'reports', 'render');
const checks = run.buildChecks;
const levelOf = (rule: string) => run.discovery.levels?.[rule] ?? 'warn';
const slug = (path: string) => path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'home';

// Report one page's findings: error-level rules fail the test, warnings annotate it.
function report(path: string, findings: Record<string, string[]>, info: any, file = slug(path)) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${file}.json`), JSON.stringify({ path, findings }, null, 2));
  for (const [rule, found] of Object.entries(findings)) {
    const level = rule === 'first-party-only' ? 'error' : levelOf(rule);
    if (level === 'off' || !found.length) continue;
    if (level === 'error') expect.soft(found, `${rule} (${path})`).toEqual([]);
    else for (const f of found) {
      console.log(`::warning::[${rule}] ${path}: ${f}`);
      info.annotations.push({ type: 'warning', description: `[${rule}] ${path}: ${f}` });
    }
  }
}

// Words and links a reader gets.
const counts = (page: Page) => page.evaluate(() => ({
  words: (document.body?.innerText ?? '').split(/\s+/).filter(Boolean).length,
  links: document.querySelectorAll('a[href]').length,
}));

// Images marked loading="lazy" inside the viewport, read at load before anything scrolls.
const lazyInView = (page: Page) => page.evaluate(() => [...document.querySelectorAll('img')]
  .filter((img) => img.loading === 'lazy' && img.getClientRects().length > 0)
  .filter((img) => { const r = img.getBoundingClientRect(); return r.top < innerHeight && r.bottom >= 0 && r.left < innerWidth && r.right >= 0; })
  .map((img) => (img.getAttribute('src') ?? img.currentSrc ?? '').slice(0, 80)));

// Content blocks (website-audit's U-19 method): text blocks of at least minBlockChars in the main
// content, keyed by tag and their first matchChars characters, with whether they are visible and
// whether they sit behind a disclosure control.
const blocks = (page: Page) => page.evaluate(({ minBlockChars, matchChars }) => {
  const EXCLUDE = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  return [...root.querySelectorAll<HTMLElement>('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, dt, dd')].flatMap((el) => {
    if (el.closest(EXCLUDE)) return [];
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text.length < minBlockChars) return [];
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    let toggle = false;
    for (let n: Element | null = el, hops = 0; n && hops < 4; n = n.parentElement, hops++)
      if (n.hasAttribute('aria-expanded') || n.tagName === 'DETAILS' || /accordion|collaps|toggle|expand/i.test(n.className?.toString() ?? '')) { toggle = true; break; }
    return [{ key: `${el.tagName.toLowerCase()}|${text.slice(0, matchChars)}`, visible: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0, toggle }];
  });
}, checks.contentParity);

for (const path of run.pages) {
  test(`${path}: no-JS content, lazy first viewport, desktop and mobile parity`, async ({ page, browser, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'Opens its own JavaScript-off and mobile contexts.');
    test.setTimeout(120_000);
    const findings: Record<string, string[]> = { 'rendered-content': [], 'lazy-first-viewport': [], 'content-parity': [] };

    // Desktop, as rendered.
    await sameOriginOnly(page);
    expect((await page.goto(path))?.status()).toBe(200);
    for (const src of await lazyInView(page)) findings['lazy-first-viewport'].push(`desktop (1440×900): ${src} is loading="lazy" in the first viewport. Load it eagerly (and fetchpriority="high" if it is the largest image).`);
    await settle(page);
    const rendered = await counts(page);
    const desktopBlocks = await blocks(page);

    // The same page with JavaScript off: what a crawler that does not render reads.
    const nojs = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const np = await nojs.newPage();
    await sameOriginOnly(np);
    await np.goto(path);
    const raw = await counts(np);
    await nojs.close();
    const { minWordRatio, minLinkRatio } = checks.renderedContent;
    const wordRatio = rendered.words ? raw.words / rendered.words : 1;
    const linkRatio = rendered.links ? raw.links / rendered.links : 1;
    if (wordRatio < minWordRatio || linkRatio < minLinkRatio)
      findings['rendered-content'].push(`without JavaScript the page has ${raw.words} of ${rendered.words} words (${wordRatio.toFixed(2)}, needs ${minWordRatio}) and ${raw.links} of ${rendered.links} links (${linkRatio.toFixed(2)}, needs ${minLinkRatio}). Crawlers for AI answers mostly do not run JavaScript: render the content at build time.`);

    // Mobile (Pixel 7): first viewport, then parity with the desktop blocks.
    const mobile = await browser.newContext({ ...devices['Pixel 7'], baseURL });
    const mp = await mobile.newPage();
    await sameOriginOnly(mp);
    await mp.goto(path);
    for (const src of await lazyInView(mp)) findings['lazy-first-viewport'].push(`mobile (Pixel 7): ${src} is loading="lazy" in the first viewport. Load it eagerly.`);
    await settle(mp);
    const mobileVisible = new Set((await blocks(mp)).filter((b) => b.visible).map((b) => b.key));
    await mobile.close();
    const missing = desktopBlocks.filter((b) => b.visible && !b.toggle && !mobileVisible.has(b.key));
    if (missing.length)
      findings['content-parity'].push(`${missing.length} content block(s) visible on desktop are missing on mobile: ${missing.slice(0, 3).map((b) => `"${b.key.split('|')[1].slice(0, 40)}…"`).join(', ')}. Google indexes the mobile page: reflow the content, or put it behind a disclosure control.`);

    report(path, findings, info);
  });
}

// first-party-only: every sitemap page loads nothing from another origin (allowedOrigins aside).
// Requests are recorded before sameOriginOnly aborts them: the attempt is the finding.
for (const path of run.policies.includes('first-party-only') ? run.sitemapPages : []) {
  test(`${path}: loads only first-party resources`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'Origins do not depend on the viewport.');
    const first = new URL(baseURL ?? 'http://localhost:4321').origin;
    const foreign = new Set<string>();
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === first || run.allowedOrigins.includes(u.origin)) return;
      foreign.add(u.origin);
    });
    await sameOriginOnly(page);
    await page.goto(path);
    await settle(page);
    report(path, { 'first-party-only': [...foreign].map((o) => `loads from ${o}. Self-host it, or list the origin in allowedOrigins with the reason it is needed.`) }, info, `origins-${slug(path)}`);
  });
}
