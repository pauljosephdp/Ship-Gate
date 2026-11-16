# Spec: back button hijacking fails the gate (from intent.md 2026-11-15)

## Requirements
1. On every `e2ePages` page, on desktop, the page test fails when the tab's session-history length grows between the
   first document's start (kept per tab in sessionStorage, with a per-document fallback) and the end of the test (load, settle, scrolling at each reflow width, tabbing), with no click.
2. The failure message starts with `history:`, names the count, and says how to fix it (`replaceState`, or an entry
   only on a visitor's action).
3. `reports/results.json` carries `browser:history` (category SEO, level error).
4. A fixture variant that pushes two entries on load fails the gate, and `expect-gate.sh` requires `browser:history`
   to read `fail` in `reports/results.json`; the conforming fixture passes. A self-test case files a `history:` failure
   under `browser:history`. A redirect after load is caught (proven locally: it races the page test, so it is no fixture).
5. A page that clears sessionStorage falls back to its own start, never a NaN count; an unreadable start fails with
   "history: could not read the starting history length".

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
