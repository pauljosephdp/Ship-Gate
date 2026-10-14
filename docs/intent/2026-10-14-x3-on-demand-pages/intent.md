# Intent: test on-demand pages, and load PostHog lazily (X3)
Author: Claude (for Paul Joseph, owner). Date: 2026-10-14. Status: accepted (Paul, 14 October 2026: "Accepted").

## Problem
Target Price (pauljosephdp/TargetPrice) needs pages that know the signed-in user: Phase 1 Part B of epics S1–S4
(sign-in, catalogue, post deal, live board) renders them on request (`export const prerender = false`) through the
Supabase client. Two things in Ship Gate stand in the way.

1. **`verify` cannot test a page the Worker renders on request.** The default `"server": "static"` serves only what
   the build emits. `"server": "preview"` exists, but the README's open items say it "has not yet been proven with the
   Cloudflare adapter in CI", and the discovery scan reads the static build only. So today a site keeps every page
   prerendered, and Target Price's gated pages (`/post-deal/`, `/me/deals/`, …) can't render the viewer on the server.
2. **The PostHog caller template loads posthog-js eagerly.** `PostHog.astro` imports `posthog-js` at the top of a
   page script, so its 94.6 KB gzip ships on the first screen. Target Price's home page totals 109.0 KB gzip of JS
   against its 100 KB first-screen budget (`docs/baseline/STATUS.md` #17); the app's own JS is 14.3 KB.

## Proposed outcome
- A site whose pages render on request passes `verify` with those pages in `pages`: smoke, axe, CSP, consent,
  keyboard, reflow and Lighthouse run against the Worker the site deploys, and the discovery scan does not fail on
  them. A static site sees no change.
- PostHog keeps every guarantee it has today (cookieless until consent, the `environment` tag, the `/ph` proxy), but
  posthog-js is no longer in the first-screen bundle: it loads after the page is interactive.
- Released as a Ship Gate minor version that web-baseline 6.6.0 pins. That web-baseline release (pauljosephdp/Skills)
  also approves `@supabase/supabase-js`, `@supabase/ssr` and `@supabase/realtime-js`, and makes `critical-gate` treat
  `supabase/migrations/**` as critical. Together these are Target Price's X3 (`docs/delivery/PHASES.md` H12).

## Affected users and systems
- Ship Gate: `scripts/prepare.mjs` (the `preview` serve command), `scripts/run-checks.sh`, the discovery scan,
  `templates/caller/posthog/` (`PostHog.astro`), README, CHANGELOG, the fixture and self-test.
- Every site, through web-baseline's `references/ship-gate.json` pin and its verbatim copy of `PostHog.astro`.
- pauljosephdp/Skills: web-baseline 6.6.0. pauljosephdp/TargetPrice: takes it with `upgrade.mjs`.

## Constraints
- No conforming static site may fail after the upgrade. `"server": "static"` stays the default.
- Nothing in the gate runs `wrangler` against a remote resource, and no gate step writes to production (a site's
  `wrangler.jsonc` may name remote D1, KV or migrations).
- No model in CI; no secret in the gate. On-demand pages that need a backend render against what the site configures
  for CI (Target Price: its mock adapter), never production data.
- `verify` stays inside its 30-minute timeout.

## Open questions
1. Does `astro preview` with `@astrojs/cloudflare` (workerd through Miniflare, local bindings only) serve the Worker in
   CI without touching remote resources, or does `preview` need its own serve script?
2. How does the discovery scan find on-demand pages: crawl the served site from `pages`, or keep `ignoreLinks` and
   rely on the browser checks?
3. Lazy PostHog: load on `requestIdleCallback` (with a timeout), or on first interaction? Events before it loads
   (page view, early clicks) must not be lost.
