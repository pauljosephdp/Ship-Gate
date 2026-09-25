// Ship Gate smoke test — every page: loads, one h1, no JS errors, WCAG 2.2 AA (axe);
// with the posthog-server-only policy, no browser PostHog calls. Runs on the desktop (1440×900) and mobile (Pixel 7) projects.
// Page lists come from the site's ship-gate.config.json via run.json, never from this file.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { run, sameOriginOnly, settle } from './helpers';

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

for (const path of run.policies.includes('turnstile-forms') ? run.formPages : []) {
  test(`${path}: Turnstile widget present`, async ({ page }) => {
    await sameOriginOnly(page);
    await page.goto(path);
    await expect(page.locator('.cf-turnstile, [data-sitekey]').first()).toBeAttached();
  });
}
