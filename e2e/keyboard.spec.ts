// Ship Gate keyboard test — a keyboard user can reach every control, is never trapped, and can
// see where focus is (WCAG 2.1.1, 2.1.2, 2.4.7, 2.4.11). axe checks the markup; this presses Tab.
// Findings warn by default while sites adopt it; "keyboard": "error" in ship-gate.config.json
// makes them fail. Runs on the desktop project only: keyboard users are on desktop layouts.
import { test, expect } from '@playwright/test';
import { run, sameOriginOnly, settle } from './helpers';

// What a focus indicator can change: outline, ring, border, background, colour, underline, on the
// element or its ::before/::after. Recorded before any Tab, compared while focused.
function installProbe() {
  const w = window as any;
  // Only what can show: an outline or border with no width is invisible whatever its colour or
  // offset (Chrome's :focus-visible changes outline-offset even under "outline: none").
  const look = (cs: CSSStyleDeclaration) => [
    cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? 'no-outline' : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`,
    ...['Top', 'Right', 'Bottom', 'Left'].map((s) => {
      const c = cs as any;
      return c[`border${s}Style`] === 'none' || parseFloat(c[`border${s}Width`]) === 0 ? '' : `${c[`border${s}Width`]} ${c[`border${s}Style`]} ${c[`border${s}Color`]}`;
    }),
    cs.boxShadow, cs.backgroundColor, cs.color, cs.textDecorationLine, cs.textDecorationThickness, cs.transform, cs.opacity,
  ].join('|');
  w.__sgLook = (el: Element) => [null, '::before', '::after'].map((p) => look(getComputedStyle(el, p))).join('#');
  w.__sgIds = new WeakMap();
  w.__sgNext = 0;
  w.__sgId = (el: Element) => { if (!w.__sgIds.has(el)) w.__sgIds.set(el, ++w.__sgNext); return w.__sgIds.get(el); };
  // The element that really has focus, through open shadow roots.
  w.__sgActive = () => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el; };
  w.__sgName = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${tag}${id}>${text ? ` "${text}"` : ''}`;
  };
}

for (const path of run.pages) {
  test(`${path}: keyboard reaches every control, no trap, visible focus`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Keyboard navigation is tested once, on the desktop layout.');
    test.setTimeout(180_000); // one Tab per control: a long page takes a while
    await page.addInitScript(installProbe);
    await sameOriginOnly(page);
    await page.goto(path);
    await settle(page);

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

    if (run.keyboard === 'error') {
      expect(problems).toEqual([]);
      return;
    }
    for (const p of problems) {
      console.log(`::warning::[keyboard] ${path}: ${p}`);
      info.annotations.push({ type: 'warning', description: `${path}: ${p}` });
    }
  });
}
