// Ship Gate reflow test — WCAG 1.4.10 and 1.4.4. At 320 CSS px (1280px at 400% zoom),
// the other narrow phone widths, and 200% zoom (1280 wide at 2x), nothing may push
// the page sideways. Content inside its own overflow-x scroller or clipper is fine:
// it does not widen the document.
import { test, expect, type Browser } from '@playwright/test';
import { run, sameOriginOnly, settle } from './helpers';

const MODES = [
  ...run.reflowWidths.map((w) => ({ label: `${w}px`, viewport: { width: w, height: 800 }, scale: 1 })),
  { label: '200% zoom (1280 @ 2x)', viewport: { width: 640, height: 512 }, scale: 2 },
];

async function overflow(browser: Browser, baseURL: string, path: string, mode: (typeof MODES)[number]) {
  const ctx = await browser.newContext({ baseURL, viewport: mode.viewport, deviceScaleFactor: mode.scale });
  const page = await ctx.newPage();
  await sameOriginOnly(page);
  const res = await page.goto(path);
  await settle(page);
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scroll = document.documentElement.scrollWidth - vw;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const culprits: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1 || clipped(el)) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      culprits.push(`${el.tagName.toLowerCase()}${id}${cls} (right edge ${Math.round(r.right)}px)`);
      if (culprits.length >= 5) break;
    }
    return { scroll, culprits };
  });
  await ctx.close();
  return { status: res?.status(), ...result };
}

for (const path of run.pages) {
  for (const mode of MODES) {
    test(`${path}: reflows at ${mode.label} without horizontal scroll`, async ({ browser, baseURL }, info) => {
      test.skip(info.project.name !== 'desktop', 'Viewports are set explicitly; one project is enough.');
      const r = await overflow(browser, baseURL!, path, mode);
      expect(r.status).toBe(200);
      expect(r.scroll, `page is ${r.scroll}px wider than the viewport`).toBeLessThanOrEqual(1);
      expect(r.culprits, 'elements past the right edge, outside any overflow container').toEqual([]);
    });
  }
}
