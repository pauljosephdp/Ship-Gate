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
  keyboard: 'warn' | 'error';
  consentEssentialCookies: string[];
  trackerHosts: string[];
  // posthog-hybrid only; null otherwise.
  posthog: null | {
    embed: 'snippet' | 'npm';
    cookieless: 'on_reject' | 'always' | 'off';
    apiHost: string;
    assetsHost: string;
    testKey: string;
  };
};

// A request to PostHog: its cloud hosts, or the site's own proxy path (posthog.apiHost).
export function isPostHog(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (/(^|\.)posthog\.com$/i.test(u.hostname)) return true;
  const proxy = run.posthog?.apiHost;
  return !!proxy?.startsWith('/') && (u.pathname === proxy || u.pathname.startsWith(`${proxy}/`));
}

// Other origins are aborted: a vendor outage must not fail a PR, and the gate
// tests this site's code. CSP still reports a blocked URL before any request is made.
// PostHog is aborted too when it is same-origin (posthog.apiHost a proxy path): the
// static server has no proxy behind that path and would answer with an HTML page,
// which the browser refuses to run as a script, failing every page on "no JS errors".
export async function sameOriginOnly(page: Page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const { hostname, protocol } = new URL(url);
    const local = hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'data:' || protocol === 'blob:';
    return local && !isPostHog(url) ? route.continue() : route.abort();
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

// ── Probes for the merged per-page test (page.spec.ts) ──

// A tracker is a request to a tracking vendor's host (trackerHosts). By hostname, never by
// path: /_astro/hubspot-partner-badge.svg is the site's own file.
export const isTracker = (url: string) => {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return run.trackerHosts.some((h) => host === h || host.endsWith(`.${h}`));
};

// Cloudflare's bot-management and load-balancing cookies are strictly necessary.
export const ALWAYS_ESSENTIAL = ['__cf_bm', 'cf_clearance', '__cflb', '_cfuvid'];

// Init script: records Content-Security-Policy violations from the first byte.
export function installCspProbe() {
  (window as any).__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) =>
    (window as any).__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'}${e.disposition === 'report' ? ' [report-only]' : ''}`));
}

// Init script: what a focus indicator can change (outline, ring, border, background, colour,
// underline, on the element or its ::before/::after), recorded before any Tab and compared while
// focused, plus helpers to identify the focused element through open shadow roots.
export function installKeyboardProbe() {
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
  w.__sgActive = () => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el; };
  w.__sgName = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${tag}${id}>${text ? ` "${text}"` : ''}`;
  };
}

// How far the settled page is wider than the viewport, and up to five elements past its right
// edge. Content inside its own overflow-x scroller or clipper is fine: it does not widen the document.
export async function measureOverflow(page: Page) {
  return page.evaluate(() => {
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
}
