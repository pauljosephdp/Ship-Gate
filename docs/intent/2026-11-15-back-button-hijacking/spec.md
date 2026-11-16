# Spec: back button hijacking fails the gate (from intent.md 2026-11-15)

## Requirements
1. On every `e2ePages` page, on desktop, the page test fails when the page's session-history length grows between its
   first byte and the end of the test (load, settle, scrolling at each reflow width, tabbing), with no click.
2. The failure message starts with `history:`, names the count, and says how to fix it (`replaceState`, or an entry
   only on a visitor's action).
3. `reports/results.json` carries `browser:history` (category SEO, level error).
4. A fixture variant that redirects after load (the form a per-document baseline misses) fails the gate on the browser
   stage, and the conforming fixture passes. A self-test case files a `history:` failure under `browser:history`.

## Design
An init script (`installHistoryProbe`, `e2e/helpers.ts`) records `history.length` before any page script runs; the
page test compares it at its end. The existing page load is reused: no extra navigation per page. `scripts/results.mjs`
sorts the `history:` message to its own record. Minor version: a new error check, as `html-size` was in v4.1.0.

## Areas of concern
A site whose own script calls `pushState` on load fails; that is the policy, and the message names the fix. The probe
cannot see entries a page adds only after a timer longer than the test, and `verify` blocks third-party requests, so
third-party code never runs here: website-audit's live check (T-11, `capture_site.py`) covers it. Post-deploy does not.
The baseline is kept per tab in sessionStorage (`__sgH0`), so a redirect after load counts (review, 15 Nov).

## Out of scope
Detecting `popstate` traps that need an existing entry; website-audit T-11 (Skills).
