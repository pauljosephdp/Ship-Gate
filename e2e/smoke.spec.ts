// Ship Gate smoke test — copied into the run's Ship Gate folder by prepare.mjs.
// Page lists come from the site's ship-gate.config.json, never from this file.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// pages.json sits beside this file, outside the site, so `astro check` never sees it.
const HERE = dirname(fileURLToPath(import.meta.url));
const { pages, formPages } = JSON.parse(readFileSync(join(HERE, 'pages.json'), 'utf8')) as {
  pages: string[];
  formPages: string[];
};

// WCAG 2.2 AA, the level Qualified Deals already gates on.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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

    const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(errors).toEqual([]);
    expect(posthogCalls, 'Browser must never call PostHog — events are server-side only').toEqual([]);
  });

  // WCAG 1.4.10 Reflow: 320 CSS px is 1280px at 400% zoom. The page must not scroll
  // sideways. A wide table scrolling inside its own overflow-x container is fine —
  // it does not widen the document.
  test(`${path}: reflows at 320px without horizontal scroll`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Viewport is set explicitly; one project is enough.');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `page is ${overflow}px wider than a 320px viewport`).toBeLessThanOrEqual(1);
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
