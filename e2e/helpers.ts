// Shared by the Ship Gate specs. Copied into the run's Ship Gate folder by prepare.mjs.
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// run.json sits beside this file, outside the site, so `astro check` never sees it.
// prepare.mjs writes it after the build, when "all" can be resolved to real pages.
export const run = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run.json'), 'utf8')) as {
  siteUrl: string;
  root: string;
  pages: string[];
  formPages: string[];
  securityHeaders: string[];
  reflowWidths: number[];
  exempt: string[];
  policies: string[];
};

// Other origins are aborted: a vendor outage must not fail a PR, and the gate
// tests this site's code. CSP still reports a blocked URL before any request is made.
export async function sameOriginOnly(page: Page) {
  await page.route('**/*', (route) => {
    const { hostname, protocol } = new URL(route.request().url());
    const local = hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'data:' || protocol === 'blob:';
    return local ? route.continue() : route.abort();
  });
}

// Motion systems fade content in on scroll. Scan the settled page, not a card
// mid-fade: scroll to the end and back, then wait for finite animations to finish.
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const running = document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState === 'running' && t && t.iterations !== Infinity;
      });
      if (running.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });
}
