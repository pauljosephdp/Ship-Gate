// Ship Gate smoke test — copied into .ship-gate/ at run time by prepare.mjs.
// Page lists come from the site's ship-gate.config.json, never from this file.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Playwright runs from the repo root; resolve from there so this works in CommonJS and ESM repos alike.
const { pages, formPages } = JSON.parse(
  readFileSync(join(process.cwd(), '.ship-gate', 'pages.json'), 'utf8'),
) as { pages: string[]; formPages: string[] };

for (const path of pages) {
  test(`${path}: 200, one h1, no JS errors, no axe violations, no browser PostHog calls`, async ({ page }) => {
    const errors: string[] = [];
    const posthogCalls: string[] = [];
    page.on('request', (r) => /(^|\.)posthog\.com$/i.test(new URL(r.url()).hostname) && posthogCalls.push(r.url()));
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('title')).not.toHaveText('');
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(errors).toEqual([]);
    expect(posthogCalls, 'Browser must never call PostHog — events are server-side only').toEqual([]);
  });
}

for (const path of formPages) {
  test(`${path}: Turnstile widget present`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('.cf-turnstile, [data-sitekey]').first()).toBeAttached();
  });
}

test('unknown route returns 404', async ({ page }) => {
  const res = await page.goto('/this-page-should-not-exist-404');
  expect(res?.status()).toBe(404);
});
