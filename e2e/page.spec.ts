// Ship Gate page test — one load per page runs every per-page check, so a page is fetched and
// settled once instead of once per check:
// - smoke: 200, one h1, a title and a meta description, no JS errors, WCAG 2.2 AA (axe), and the
//   PostHog policy (posthog-server-only: no browser PostHog calls). Desktop (1440×900) and mobile (Pixel 7).
// - consent (consent-before-tracking): before any choice, no cookie beyond the essential ones and
//   no tracker. Consent-first privacy law (GDPR and ePrivacy in the EU, and similar regimes elsewhere)
//   requires it. With posthog-hybrid in a cookieless mode, PostHog may load but may store nothing
//   (no ph_ cookie, localStorage or sessionStorage) until the visitor accepts.
// - CSP: a page that sends a Content-Security-Policy (enforced or Report-Only, from _headers or a
//   <meta> tag) loads with zero violations. A missing host in connect-src once broke analytics on a green build.
// - keyboard: Tab reaches every control, no trap, visible focus (WCAG 2.1.1, 2.1.2, 2.4.7, 2.4.11).
//   Findings warn by default; "keyboard": "error" in ship-gate.config.json makes them fail.
// - reflow (WCAG 1.4.10): at each narrow width (320 CSS px is 1280px at 400% zoom) nothing pushes the
//   page sideways. 200% zoom (1280 wide at 2x) needs its own context and is a separate test.
// Consent, CSP, keyboard and reflow run on the desktop project only. Every check is a soft
// assertion, so one test reports every failing check on the page.
// Page lists come from the site's ship-gate.config.json via run.json, never from this file.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  run, sameOriginOnly, settle, isPostHog, isTracker, ALWAYS_ESSENTIAL,
  installCspProbe, installKeyboardProbe, measureOverflow,
} from './helpers';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const consentOn = run.policies.includes('consent-before-tracking') && !run.exempt.includes('consent');

for (const path of run.pages) {
  test(`${path}: smoke, axe, consent, CSP, keyboard and reflow`, async ({ page, context }, info) => {
    const desktop = info.project.name === 'desktop';
    test.setTimeout(240_000); // one Tab per control: a long page takes a while
    const errors: string[] = [];
    const posthogCalls: string[] = [];
    const trackers = new Set<string>();
    const consoleCsp: string[] = [];
    page.on('request', (r) => {
      if (/(^|\.)posthog\.com$/i.test(new URL(r.url()).hostname)) posthogCalls.push(r.url());
      // Recorded before sameOriginOnly aborts it: an attempt is the violation.
      if (isTracker(r.url())) trackers.add(r.url().slice(0, 100));
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text());
      // An aborted third-party request logs "Failed to load resource"; that is the gate, not the site.
      if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    if (desktop) {
      await page.addInitScript(installCspProbe);
      await page.addInitScript(installKeyboardProbe);
    }
    await sameOriginOnly(page);

    // ── Smoke ──
    const loaded = Date.now();
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect.soft(page.locator('h1')).toHaveCount(1);
    expect.soft((await page.title()).trim(), 'page has no <title>').not.toBe('');
    await expect.soft(page.locator('meta[name="description"]')).toHaveCount(1);
    await settle(page);

    // ── Consent: before anything is clicked or pressed, and at least 1.5 s after load ──
    if (desktop && consentOn) {
      await page.waitForTimeout(Math.max(0, 1500 - (Date.now() - loaded)));
      // A tag blocked by CSP never makes a request, so read the markup too.
      const tags: string[] = await page.$$eval('script[src], iframe[src], img[src], link[href]',
        (els) => els.map((e) => (e as HTMLScriptElement).src || (e as HTMLLinkElement).href || ''));
      for (const u of tags) if (isTracker(u)) trackers.add(u.slice(0, 100));
      const essential = new Set([...ALWAYS_ESSENTIAL, ...run.consentEssentialCookies]);
      const cookies = (await context.cookies()).map((c) => c.name).filter((n) => !essential.has(n));
      const stored = run.posthog
        ? (await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])).filter((k) => /^(ph_|__ph)/.test(k))
        : [];
      expect.soft([
        ...[...trackers].map((u) => `tracker loads before consent: ${u}`),
        ...cookies.map((n) => `cookie "${n}" is set before consent. If it is strictly necessary, list it in consentEssentialCookies.`),
        ...stored.map((k) => `PostHog stores "${k}" before consent. Use cookieless_mode 'on_reject' with opt_out_capturing_by_default, or 'always'.`),
      ], 'consent: nothing tracks before the visitor chooses').toEqual([]);
    }

    // ── axe, JS errors, PostHog policy ──
    // Cloudflare Zaraz renders into shadow DOM that axe misreads; it is not the site's markup.
    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('[id^="zaraz"]').analyze();
    expect.soft(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`), 'axe (WCAG 2.2 AA)').toEqual([]);
    if (run.policies.includes('posthog-server-only') && !run.exempt.includes('posthog-client'))
      expect.soft(posthogCalls, 'Browser must never call PostHog — events are server-side only').toEqual([]);
    if (!desktop) {
      expect.soft(errors, 'no JS errors').toEqual([]);
      return;
    }

    // ── CSP ──
    const h = res?.headers() ?? {};
    const hasMeta = (await page.locator('meta[http-equiv="Content-Security-Policy" i]').count()) > 0;
    if (h['content-security-policy'] || h['content-security-policy-report-only'] || hasMeta) {
      await page.waitForTimeout(500);
      const violations: string[] = await page.evaluate(() => (window as any).__cspViolations);
      // The event names the directive; the console catches refusals that fire no event.
      expect.soft(violations.length ? [...new Set(violations)] : [...new Set(consoleCsp)], 'no Content-Security-Policy violations').toEqual([]);
    }
    expect.soft(errors, 'no JS errors').toEqual([]);

    // ── Keyboard (desktop layout: keyboard users are on desktop) ──
    const count = await page.evaluate(() => {
      const w = window as any;
      const sel = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable="true"]';
      const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) =>
        el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]'));
      w.__sgBefore = new Map(els.map((el) => [el, w.__sgLook(el)]));
      return els.length;
    });
    const problems: string[] = [];
    const visited = new Set<number>();
    let last = -1, leftPage = count === 0;
    // Shadow DOM and same-origin frames hold controls the count can't see; leave room for them.
    for (let i = 0; i < count * 2 + 20 && !leftPage; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      const r = await page.evaluate(() => {
        const w = window as any;
        const el = w.__sgActive();
        if (!el || el === document.body || el === document.documentElement) return null;
        const rect = el.getBoundingClientRect();
        const before = w.__sgBefore.get(el);
        return {
          id: w.__sgId(el) as number,
          name: w.__sgName(el) as string,
          frame: el.tagName === 'IFRAME',
          inView: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
          indicator: before === undefined || before !== w.__sgLook(el),
        };
      });
      // Focus back on the document after the last control: the page let go.
      if (r === null) { if (visited.size > 0) { leftPage = true; break; } continue; }
      if (r.id === last && !r.frame) { problems.push(`focus stays on ${r.name}: Tab does not move it (keyboard trap, WCAG 2.1.2).`); break; }
      last = r.id;
      if (visited.has(r.id)) { problems.push(`focus cycles back to ${r.name} without leaving the page: a focus trap keeps keyboard users inside ${visited.size} control(s) (WCAG 2.1.2).`); leftPage = true; break; }
      visited.add(r.id);
      if (!r.inView) problems.push(`${r.name} takes focus but is off-screen or has no size, so a keyboard user cannot see where they are (WCAG 2.4.11).`);
      else if (!r.indicator) problems.push(`${r.name} shows no visible change when focused. Keep a :focus-visible outline or ring (WCAG 2.4.7).`);
    }
    if (!leftPage) problems.push(`after ${count * 2 + 20} Tab presses focus never left the page (keyboard trap, WCAG 2.1.2).`);
    if (run.keyboard === 'error') expect.soft(problems, 'keyboard').toEqual([]);
    else for (const p of problems) {
      console.log(`::warning::[keyboard] ${path}: ${p}`);
      info.annotations.push({ type: 'warning', description: `${path}: ${p}` });
    }

    // ── Reflow at each narrow width, on the same page ──
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const width of run.reflowWidths) {
      await page.setViewportSize({ width, height: 800 });
      await settle(page);
      const r = await measureOverflow(page);
      expect.soft(r.scroll, `${width}px: page is ${r.scroll}px wider than the viewport`).toBeLessThanOrEqual(1);
      expect.soft(r.culprits, `${width}px: elements past the right edge, outside any overflow container`).toEqual([]);
    }
  });

  test(`${path}: reflows at 200% zoom (1280 @ 2x) without horizontal scroll`, async ({ browser, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'Viewports are set explicitly; one project is enough.');
    const ctx = await browser.newContext({ baseURL, viewport: { width: 640, height: 512 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await sameOriginOnly(page);
    const res = await page.goto(path);
    await settle(page);
    const r = await measureOverflow(page);
    await ctx.close();
    expect(res?.status()).toBe(200);
    expect(r.scroll, `page is ${r.scroll}px wider than the viewport`).toBeLessThanOrEqual(1);
    expect(r.culprits, 'elements past the right edge, outside any overflow container').toEqual([]);
  });
}

// posthog-hybrid: PostHog starts on every page before any consent choice. Its requests are
// recorded before sameOriginOnly aborts them: the attempt is the proof. The npm embed runs the
// real SDK, so it must be loaded, capturing, and in the configured cookieless mode; the
// snippet's SDK comes from PostHog's CDN (aborted here), so its stub must exist.
for (const path of run.posthog ? run.pages : []) {
  test(`${path}: PostHog loads and captures`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'PostHog loading does not depend on the viewport; one project is enough.');
    const calls: string[] = [];
    page.on('request', (r) => isPostHog(r.url()) && calls.push(r.url()));
    await sameOriginOnly(page);
    await page.goto(path);
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const ph = (window as any).posthog;
      if (!ph || typeof ph.init !== 'function') return null;
      return {
        loaded: !!ph.__loaded,
        capturing: typeof ph.is_capturing === 'function' ? ph.is_capturing() : null,
        cookieless: ph.config?.cookieless_mode ?? 'off',
      };
    });
    expect(state, 'window.posthog is missing: the PostHog component did not run on this page').not.toBeNull();
    expect(calls.length, 'the page never tried to reach PostHog').toBeGreaterThan(0);
    if (run.posthog?.embed === 'npm') {
      expect(state?.loaded, 'posthog-js did not finish init').toBe(true);
      expect(state?.capturing, 'PostHog must capture before any consent choice').toBe(true);
      expect(state?.cookieless, 'cookieless_mode differs from posthog.cookieless in ship-gate.config.json').toBe(run.posthog.cookieless);
    }
  });
}

// posthog-hybrid, npm embed, cookieless "on_reject": accepting switches PostHog to its cookies.
// (The snippet's SDK comes from PostHog's CDN, which the gate aborts; "always" never stores.)
const optIn = consentOn && run.posthog?.embed === 'npm' && run.posthog.cookieless === 'on_reject';
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

for (const path of run.policies.includes('turnstile-forms') ? run.formPages : []) {
  test(`${path}: Turnstile widget present`, async ({ page }) => {
    await sameOriginOnly(page);
    await page.goto(path);
    await expect(page.locator('.cf-turnstile, [data-sitekey]').first()).toBeAttached();
  });
}
