# Spec: back button hijacking fails the gate (from intent.md 2026-11-15)

## Requirements
1. On every `e2ePages` page, on desktop, the page test fails when the page's session-history length grows between its
   first byte and the end of the test (load, settle, scrolling at each reflow width, tabbing), with no click.
2. The failure message starts with `history:`, names the count, and says how to fix it (`replaceState`, or an entry
   only on a visitor's action).
3. `reports/results.json` carries `browser:history` (category SEO, level error).
4. A fixture variant that pushes two entries on load and re-pushes on `popstate` fails the gate on the browser stage,
   and the conforming fixture passes.

## Design
An init script (`installHistoryProbe`, `e2e/helpers.ts`) records `history.length` before any page script runs; the
page test compares it at its end. The existing page load is reused: no extra navigation per page. `scripts/results.mjs`
sorts the `history:` message to its own record. Minor version: a new error check, as `html-size` was in v4.1.0.

## Areas of concern
A site whose own script calls `pushState` on load fails; that is the policy, and the message names the fix. The probe
cannot see entries a page adds only after a timer longer than the test; the post-deploy and website-audit live check
(T-11) covers third-party code that waits.

## Out of scope
Detecting `popstate` traps that need an existing entry; website-audit T-11 (Skills).
