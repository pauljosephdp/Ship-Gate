// Ship Gate render test — the discovery rules that need the served build in a browser. They came
// from website-audit (pauljosephdp/Skills) on 2026-11-14: anything the build served on localhost can
// prove is Ship Gate's, so website-audit reads these results instead of re-testing them.
// - rendered-content: the no-JS ratio. Words and links in the page with JavaScript off, against the
//   rendered page. Crawlers for AI answers mostly do not run JavaScript (Googlebot does; Bingbot less
//   reliably; Baiduspider and Naver's Yeti much less), so content that exists only after script runs is
//   invisible to them. Thresholds: buildChecks.renderedContent in standards/standards.json.
// - lazy-first-viewport: an <img loading="lazy"> in the first viewport, on desktop or mobile, delays
//   the very paint it appears to help (often the LCP image).
// - content-parity: the main content's words on mobile against desktop: 15% or more missing on
//   mobile warns (removed, not reflowed). Mobile-first indexing reads the mobile page. Text behind a
//   disclosure control counts as present; outside <main>, header, nav, footer and asides are left out.
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

// The words of the main content (<main>, else the body without header, nav, footer and aside) a reader
// can get at: visible text, and text behind a disclosure control (<details>, a panel an aria-controls
// names, accordion or collapse classes), which mobile layouts fold away on purpose. Case-folded, split on
// anything that is not a letter or digit.
const mainWords = (page: Page) => page.evaluate(() => {
  const root = document.querySelector('main, [role="main"]') ?? document.body;
  const CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], script, style, noscript, template';
  const controlled = new Set([...document.querySelectorAll('[aria-controls]')].flatMap((c) => (c.getAttribute('aria-controls') ?? '').split(/\s+/)));
  const disclosed = (el: Element) => !!el.closest('details, [class*="accordion"], [class*="collaps"], [class*="toggle"], [class*="expand"]')
    || [...controlled].some((id) => id && el.closest(`#${CSS.escape(id)}`));
  const words: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || (root === document.body && el.closest(CHROME)) || el.closest('script, style, noscript, template')) continue;
    if (!el.checkVisibility() && !disclosed(el)) continue;
    words.push(...(n.textContent ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  }
  return words;
});

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
    const desktopWords = await mainWords(page);

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

    // Mobile (Pixel 7): first viewport, then parity with the desktop words.
    const mobile = await browser.newContext({ ...devices['Pixel 7'], baseURL });
    const mp = await mobile.newPage();
    await sameOriginOnly(mp);
    await mp.goto(path);
    for (const src of await lazyInView(mp)) findings['lazy-first-viewport'].push(`mobile (Pixel 7): ${src} is loading="lazy" in the first viewport. Load it eagerly.`);
    await settle(mp);
    const mobileLeft = new Map<string, number>();
    for (const w of await mainWords(mp)) mobileLeft.set(w, (mobileLeft.get(w) ?? 0) + 1);
    await mobile.close();
    // Words of the desktop text with no match left on mobile (counted, so a repeated word must repeat).
    const missing: string[] = [];
    for (const w of desktopWords) { const k = mobileLeft.get(w) ?? 0; if (k > 0) mobileLeft.set(w, k - 1); else missing.push(w); }
    const share = desktopWords.length ? missing.length / desktopWords.length : 0;
    if (share >= checks.contentParity.maxMissingRatio)
      findings['content-parity'].push(`mobile is missing ${missing.length} of the ${desktopWords.length} words of the desktop main content (${Math.round(share * 100)}%, warns from ${Math.round(checks.contentParity.maxMissingRatio * 100)}%), e.g. "${missing.slice(0, 8).join(' ')}". Google indexes the mobile page: reflow the content, or put it behind a disclosure control.`);

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
