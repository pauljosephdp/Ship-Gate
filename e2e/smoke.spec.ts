// Ship Gate smoke test — every page: loads, one h1, no JS errors, WCAG 2.2 AA (axe);
// with the posthog-server-only policy, no browser PostHog calls; with posthog-hybrid, PostHog loads on every
// page. Runs on the desktop (1440×900) and mobile (Pixel 7) projects.
// Page lists come from the site's ship-gate.config.json via run.json, never from this file.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { run, sameOriginOnly, settle, isPostHog } from './helpers';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const path of run.pages) {
  test(`${path}: 200, one h1, no JS errors, no axe violations`, async ({ page }) => {
    const errors: string[] = [];
    const posthogCalls: string[] = [];
    page.on('request', (r) => /(^|\.)posthog\.com$/i.test(new URL(r.url()).hostname) && posthogCalls.push(r.url()));
    page.on('pageerror', (e) => errors.push(e.message));
    // An aborted third-party request logs "Failed to load resource"; that is the gate, not the site.
    page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await sameOriginOnly(page);

    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    expect((await page.title()).trim(), 'page has no <title>').not.toBe('');
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);

    await settle(page);
    // Cloudflare Zaraz renders into shadow DOM that axe misreads; it is not the site's markup.
    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('[id^="zaraz"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`)).toEqual([]);
    expect(errors).toEqual([]);
    if (run.policies.includes('posthog-server-only') && !run.exempt.includes('posthog-client'))
      expect(posthogCalls, 'Browser must never call PostHog — events are server-side only').toEqual([]);
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

for (const path of run.policies.includes('turnstile-forms') ? run.formPages : []) {
  test(`${path}: Turnstile widget present`, async ({ page }) => {
    await sameOriginOnly(page);
    await page.goto(path);
    await expect(page.locator('.cf-turnstile, [data-sitekey]').first()).toBeAttached();
  });
}
