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
- `scripts/check-market.mjs`: hosts from the file.
- `scripts/prepare.mjs`: trackers, sitemap pages, `first-party-only` + `allowedOrigins`, `standard`
  delegation, `posthog-secrets` guard, retired-rule overrides, Playwright JSON reporter, render spec copied.
- `scripts/guards.sh`: delegation skips, `posthog-secrets` an error.
- `e2e/helpers.ts`: tracker entries, levels and sitemap pages in the `run` type.
- `e2e/render.spec.ts` (new): no-JS ratio, lazy first viewport, parity, first-party-only.
- `scripts/check-structure.mjs`: findings tagged with ids, `reports/structure.json`.
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

Each step is its own commit. The steps share `discovery.mjs`, `prepare.mjs` and `self-test.sh`, so the
commits group files by concern, and `self-test` is green from the post-deploy commit on. Before it, the tests
run ahead of the code: the rule-file commit's unit test already forbids the lists `discovery.mjs` drops in the
next commit, and the discovery commit's `self-test.sh` covers the guards and live checks of the two after it.

## Risks
- A correct site fails: the training-token change and Organization `url` (spec, areas of concern) are the
  intended breaks; anything else that turns a conforming fixture red is a bug. The local fixture run checks it.
- A check that can no longer fail: each new rule has a failing self-test case, and the render spec is run
  against a page built to break it.
- `results.json` must never fail the gate: its step is `continue-on-error` and is not in the summary.
- The browser rules add two page loads per page (no-JS, mobile) on desktop only; `e2ePages` bounds it.
- Not taken: editing `e2e/page.spec.ts` (protected) to share its page load.

## Proof
Run in this cloud session on 2026-11-14, on branch `claude/standards-v4` (local only, not pushed).

`bash scripts/self-test.sh` (new cases for every rule, the delegation, the policy, the narrowed post-deploy
and results.json):
```
  ✓ posthog-proxy, ci-health and other unit tests pass

Self-test: 612 passed, 0 failed.
```
`shellcheck -S error scripts/*.sh test/*.sh .claude/hooks/*.sh` → no output (exit 0).

`bash scripts/check-readme.sh origin/main` → `README.md is up to date.`

`node --test test/*.test.mjs` (includes the new `test/standards.test.mjs`):
```
# tests 20
# pass 20
# fail 0
```
Browser suite on `test/fixture-site` (verifier step 4: `npm ci`, `npm run build`, `prepare.mjs verify` and
`after-build`, guards and every scan, then the generated Playwright config with `CI=1`; Chromium from the
session's `/usr/bin/google-chrome` through `launchOptions.executablePath`, since the Playwright download is
not available here). Conforming: guards, structure, discovery (no warnings), copy, market and dist pass, then
```
  18 skipped
  22 passed (13.7s)
```
A copy broken four ways (a `loading="lazy"` hero, a desktop-only paragraph, 400 words and 30 links written by
a same-origin script, a third-party pixel) with `first-party-only` and `content-parity` raised to error:
```
::warning::[rendered-content] /: without JavaScript the page has 78 of 537 words (0.15, needs 0.7) and 4 of 34 links (0.12, needs 0.5). …
::warning::[lazy-first-viewport] /: desktop (1440×900): /og.png is loading="lazy" in the first viewport. …
::warning::[lazy-first-viewport] /: mobile (Pixel 7): /og.png is loading="lazy" in the first viewport. …
  ✘  3 [desktop] › render.spec.ts:75:3 › /: no-JS content, lazy first viewport, desktop and mobile parity
  ✘  5 [desktop] › render.spec.ts:121:3 › /: loads only first-party resources
  2 failed
  6 passed (5.7s)
```
and `results.mjs` on that run: `content-parity` fail, `first-party-only` fail, `rendered-content` warn,
`lazy-first-viewport` warn, each with sample `/`. `test/fixture-worker` builds, and its contract, discovery and
structure scans pass.

Not run here: the `fixture` CI jobs (they run on the PR), the reviewer subagent (this session could not start
one; the diff was reviewed against this plan by hand), and agent evals (`CLAUDE.md`, `REVIEW.md` and
`.claude/` are unchanged).

## Review fixes (2026-11-14)
A fresh-context review of the branch raised eight findings; each is a commit after the proof above.
1. `structured-data` failed nested references: `jsonLdScope` in `standards.json` limits the Organization and
   LocalBusiness rows to the top of a block and `publisher`, and the Offer row to a Product's or Event's
   `offers`, where `priceSpecification` (price and currency) may carry the price.
2. Delegation matched the script name only. web-baseline's `conform.mjs` (read in `pauljosephdp/Skills`) enforces
   every phase only with `--final`, and a recorded deviation can waive a forbidden path or required content.
   So the contract requires `conform.mjs ... --final`, and only `node-pin` (no deviation applies) is delegated;
   `env-file`, `tailwind-config`, `posthog-secrets` and the layout wiring stay guards. Departs from the spec's
   requirement 10, which named five guards.
3. `sitemap-lastmod-bulk`: 10 or more URLs with a `lastmod`, 90% on one value; exempt when that is the first
   commit's date (in a full clone) or the site has `src/data/lastmod.json`.
4. `faq-markup-missing`: 2 or more question-and-answer pairs in `<main>`, outside the page chrome.
5. `market-cn`: resources only; a blocked URL in script that is not visibly loaded warns.
6. CHANGELOG migration lists the AI-search widening, the training token and the JSON-LD scope.
7. `results.json`: `guard:<id>` per guard (`reports/guards.tsv`, ids in `scripts/gate-rules.mjs`), `browser:<check>`
   per page-test check (sorted by assertion message, since `e2e/page.spec.ts` is protected), and a render test
   that threw fails its rules.
8. `content-parity`: the main content's words per viewport, warn from 15% missing on mobile.

Proof after the fixes:
```
Self-test: 643 passed, 0 failed.
```
`node --test test/*.test.mjs` → `# pass 21`, `# fail 0`; ShellCheck → no output; `check-readme.sh origin/main` →
`README.md is up to date.` The render spec on the broken fixture copy: 120 desktop-only words of 720 →
`mobile is missing 120 of the 720 words … (17%, warns from 15%)`, 80 words in a closed `<details>` not
counted missing, and 60 of 660 (9%) quiet. `results.mjs` on that run's page test: `browser:smoke`, `browser:csp`
and `browser:reflow` fail on `/`, `browser:axe` passes.

