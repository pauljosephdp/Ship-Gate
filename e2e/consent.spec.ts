// Ship Gate consent test (consent-before-tracking policy) — before a visitor makes a choice,
// the page sets no cookie beyond the essential ones and loads no tracker. Consent-first privacy
// law (GDPR and ePrivacy in the EU, and similar regimes elsewhere) requires it for
// non-essential tracking. A tracker is a request to a tracking vendor's host (trackerHosts).
// With posthog-hybrid in a cookieless mode, PostHog may load before consent, but may store
// nothing (no ph_ cookie, localStorage or sessionStorage) until the visitor accepts.
import { test, expect } from '@playwright/test';
import { run, sameOriginOnly } from './helpers';

// By hostname, never by path: /_astro/hubspot-partner-badge.svg is the site's own file.
const isTracker = (url: string) => {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return run.trackerHosts.some((h) => host === h || host.endsWith(`.${h}`));
};

// Cloudflare's bot-management and load-balancing cookies are strictly necessary.
const ALWAYS_ESSENTIAL = ['__cf_bm', 'cf_clearance', '__cflb', '_cfuvid'];

const on = run.policies.includes('consent-before-tracking') && !run.exempt.includes('consent');
for (const path of on ? run.pages : []) {
  test(`${path}: no tracking cookie or tracker before consent`, async ({ page, context }, info) => {
    test.skip(info.project.name !== 'desktop', 'Consent does not depend on the viewport; one project is enough.');
    const attempted = new Set<string>();
    // Requests are recorded before sameOriginOnly aborts them: an attempt is the violation.
    page.on('request', (r) => { if (isTracker(r.url())) attempted.add(r.url().slice(0, 100)); });
    await sameOriginOnly(page);
    await page.goto(path);
    await page.waitForTimeout(1500);

    // A tag blocked by CSP never makes a request, so read the markup too.
    const tags: string[] = await page.$$eval('script[src], iframe[src], img[src], link[href]',
      (els) => els.map((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href || ''));
    for (const u of tags) if (isTracker(u)) attempted.add(u.slice(0, 100));

    const essential = new Set([...ALWAYS_ESSENTIAL, ...run.consentEssentialCookies]);
    const cookies = (await context.cookies()).map((c) => c.name).filter((n) => !essential.has(n));
    const stored = run.posthog
      ? (await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])).filter((k) => /^(ph_|__ph)/.test(k))
      : [];

    const problems = [
      ...[...attempted].map((u) => `tracker loads before consent: ${u}`),
      ...cookies.map((n) => `cookie "${n}" is set before consent. If it is strictly necessary, list it in consentEssentialCookies.`),
      ...stored.map((k) => `PostHog stores "${k}" before consent. Use cookieless_mode 'on_reject' with opt_out_capturing_by_default, or 'always'.`),
    ];
    expect(problems).toEqual([]);
  });
}

// posthog-hybrid, npm embed, cookieless "on_reject": accepting switches PostHog to its cookies.
// (The snippet's SDK comes from PostHog's CDN, which the gate aborts; "always" never stores.)
const optIn = on && run.posthog?.embed === 'npm' && run.posthog.cookieless === 'on_reject';
for (const path of optIn ? run.pages.slice(0, 1) : []) {
  test(`${path}: PostHog stores its identity once the visitor accepts`, async ({ page, context }, info) => {
    test.skip(info.project.name !== 'desktop', 'Consent does not depend on the viewport; one project is enough.');
    await sameOriginOnly(page);
    await page.goto(path);
    await page.waitForFunction(() => (window as any).posthog?.__loaded === true);
    await page.evaluate(() => (window as any).posthog.opt_in_capturing());
    await page.waitForTimeout(500);
    const cookies = (await context.cookies()).map((c) => c.name).filter((n) => n.startsWith('ph_'));
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph_')));
    expect([...cookies, ...stored], 'after opt_in_capturing(), PostHog should persist its identity').not.toEqual([]);
  });
}
