// Ship Gate consent test (consent-before-tracking policy) — before a visitor makes a choice,
// the page sets no cookie beyond the essential ones and loads no tracker. Consent-first privacy
// law (GDPR and ePrivacy in the EU, and similar regimes elsewhere) requires it for
// non-essential tracking. Trackers come from the list Lighthouse blocks.
import { test, expect } from '@playwright/test';
import { run, sameOriginOnly, globRe } from './helpers';

// Cloudflare's bot-management and load-balancing cookies are strictly necessary.
const ALWAYS_ESSENTIAL = ['__cf_bm', 'cf_clearance', '__cflb', '_cfuvid'];

const on = run.policies.includes('consent-before-tracking') && !run.exempt.includes('consent');
for (const path of on ? run.pages : []) {
  test(`${path}: no tracking cookie or tracker before consent`, async ({ page, context }, info) => {
    test.skip(info.project.name !== 'desktop', 'Consent does not depend on the viewport; one project is enough.');
    const trackers = run.trackerPatterns.map(globRe);
    const attempted = new Set<string>();
    // Requests are recorded before sameOriginOnly aborts them: an attempt is the violation.
    page.on('request', (r) => { if (trackers.some((t) => t.test(r.url()))) attempted.add(r.url().slice(0, 100)); });
    await sameOriginOnly(page);
    await page.goto(path);
    await page.waitForTimeout(1500);

    // A tag blocked by CSP never makes a request, so read the markup too.
    const tags: string[] = await page.$$eval('script[src], iframe[src], img[src], link[href]',
      (els) => els.map((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href || ''));
    for (const u of tags) if (trackers.some((t) => t.test(u))) attempted.add(u.slice(0, 100));

    const essential = new Set([...ALWAYS_ESSENTIAL, ...run.consentEssentialCookies]);
    const cookies = (await context.cookies()).map((c) => c.name).filter((n) => !essential.has(n));

    const problems = [
      ...[...attempted].map((u) => `tracker loads before consent: ${u}`),
      ...cookies.map((n) => `cookie "${n}" is set before consent. If it is strictly necessary, list it in consentEssentialCookies.`),
    ];
    expect(problems).toEqual([]);
  });
}
