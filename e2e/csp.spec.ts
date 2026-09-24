// Ship Gate CSP test — a Content-Security-Policy is only as good as the browser's
// verdict on the real page. Every page that sends a CSP (enforced or Report-Only,
// from _headers or a <meta> tag) must load with zero violations. A missing host
// in connect-src once broke analytics on a green build; this catches that class.
import { test, expect } from '@playwright/test';
import { run, sameOriginOnly, settle } from './helpers';

for (const path of run.pages) {
  test(`${path}: no Content-Security-Policy violations`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'CSP does not depend on the viewport; one project is enough.');
    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as any).__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'}${e.disposition === 'report' ? ' [report-only]' : ''}`));
    });
    const consoleCsp: string[] = [];
    page.on('console', (m) => /Content Security Policy/i.test(m.text()) && consoleCsp.push(m.text()));
    await sameOriginOnly(page);

    const res = await page.goto(path);
    const h = res?.headers() ?? {};
    const hasMeta = (await page.locator('meta[http-equiv="Content-Security-Policy" i]').count()) > 0;
    test.skip(!h['content-security-policy'] && !h['content-security-policy-report-only'] && !hasMeta, 'This page sends no CSP.');

    await settle(page);
    await page.waitForTimeout(500);
    const violations: string[] = await page.evaluate(() => (window as any).__cspViolations);
    // The event names the directive; the console catches refusals that fire no event.
    expect(violations.length ? [...new Set(violations)] : [...new Set(consoleCsp)]).toEqual([]);
  });
}
