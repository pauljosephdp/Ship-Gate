# Plan: one rule file, zero overlap with website-audit (from spec.md 2026-11-14)

## Files that change
- `standards/standards.json` (new): the contract plus `chinaBlockedHosts`, `chinaUnreliableHosts`,
  `trackerVendors`, `buildChecks`.
- `scripts/standards.mjs` (new): loader, derived crawler lists, tracker matcher.
- `scripts/discovery.mjs`: lists and `missingProps` from the file; `llmsTxt` flags; new rules
  (`ai-training-optout-scope`, `sitemap-lastmod-bulk`, `img-dimensions`, `faq-markup-missing`,
  `orphan-pages`, `click-depth`, `lazy-first-viewport`, `content-parity`); `rendered-content` moves to the
  browser; `markdown-negotiation` retired; `link-headers`, `ai-training`, `ai-uses-allowed` build only.
- `scripts/check-discovery.mjs`: the new build rules, the link graph, `discovery.json`.
- `scripts/check-structure.mjs`: findings tagged with ids, `structure.json`.
- `scripts/check-market.mjs`: hosts from the file.
- `scripts/prepare.mjs`: trackers, sitemap pages, `first-party-only` + `allowedOrigins`, `standard`
  delegation, `posthog-secrets` guard, retired-rule overrides, Playwright JSON reporter, render spec copied.
- `scripts/guards.sh`: delegation skips, `posthog-secrets` an error.
- `e2e/helpers.ts`: tracker entries, levels and sitemap pages in the `run` type.
- `e2e/render.spec.ts` (new): no-JS ratio, lazy first viewport, parity, first-party-only.
- `scripts/check-live.mjs`, `scripts/check-headers-live.mjs`, `scripts/post-deploy.sh`,
  `post-deploy/action.yml`: deploy health only; `scripts/check-analytics-live.mjs` deleted.
- `scripts/results.mjs` (new) and `action.yml`: `reports/results.json` on every run.
- `templates/caller/.github/workflows/full-sweep.yml`: upload `ship-gate-results`; all caller pins v4.0.0;
  `post-deploy.yml` loses the `crux-api-key` comment.
- `test/fixture-site/public/robots.txt`, `test/fixture-worker/public/robots.txt`: MistralAI-Training.
- `test/standards.test.mjs` (new): the file's shape and the derived lists.
- `scripts/self-test.sh`: cases for every new rule, the delegation, the policy, the live checks removed.
- `README.md`, `CHANGELOG.md` (v4.0.0 with migration), this folder.

## Order of work
1. Intent, spec, plan.
2. The rule file and its readers (discovery, market, consent), `ai-training-optout-scope`, fixture robots.
3. Build checks moved in, the render spec, `first-party-only`.
4. Delegation and `posthog-secrets`.
5. Post-deploy narrowed to deploy health.
6. `results.json` and the full-sweep upload.
7. README, CHANGELOG, pins; self-test, unit tests, a local run of the browser suite on the fixture.

Each step is its own commit; self-test runs after each.

## Risks
- A correct site fails: the training-token change and Organization `url` (spec, areas of concern) are the
  intended breaks; anything else that turns a conforming fixture red is a bug. The local fixture run checks it.
- A check that can no longer fail: each new rule has a failing self-test case, and the render spec is run
  against a page built to break it.
- `results.json` must never fail the gate: its step is `continue-on-error` and is not in the summary.
- The browser rules add two page loads per page (no-JS, mobile) on desktop only; `e2ePages` bounds it.
- Not taken: editing `e2e/page.spec.ts` (protected) to share its page load.

## Proof
Filled in at the end of the work (commands and their pasted tails).
