# Spec: one rule file, zero overlap with website-audit (from intent.md 2026-11-14)

## Requirements
1. `standards/standards.json` holds the contract draft unchanged in schema and values, plus:
   `chinaBlockedHosts` (the union of `check-market.mjs` and website-audit's `check_compliance.py` lists),
   `chinaUnreliableHosts`, `trackerVendors` (the union of Ship Gate's consent list and website-audit's
   categorised list, with the consent-sensitive categories named), and `buildChecks` (thresholds for the
   checks moved in, each traced to the website-audit script it came from).
2. `scripts/discovery.mjs` derives every crawler list from the file: `robots-blocks-page` checks the
   `searchMustAllow` search engines (Googlebot, bingbot); `ai-search-crawlers` the rest of `searchMustAllow`
   plus `userFetchShouldAllow`; `ai-training` blocks `groups.trainingOnly` by default (`reserve` and `allow`
   unchanged); retired tokens and the JSON-LD required properties (`jsonLdRequired`) come from the file.
3. The llms.txt rules read `llmsTxt` (H1, summary, links required; sections optional; missing = warn).
4. `check-market.mjs` reads `chinaBlockedHosts` and `chinaUnreliableHosts`; the consent test reads the
   consent-sensitive categories of `trackerVendors` (through `run.json`).
5. New rule `ai-training-optout-scope` (GEO, warn): a line naming `__usage_ai-training` inside a group that
   applies to `User-agent: *` has no effect; the opt-out needs its own `User-agent: __usage_ai-training` group.
6. Checks moved in (build): `sitemap-lastmod-bulk` (SEO, warn: at least 5 URLs share one `lastmod`, or a
   `lastmod` carries the build's own time), `img-dimensions` (perf, error: a local `<img>` without `width` and
   `height`), `faq-markup-missing` (AEO, warn: a visible FAQ pattern with no FAQPage JSON-LD),
   `orphan-pages` (SEO, warn: an indexable page no other page links to) and `click-depth` (SEO, warn: more
   than 3 clicks from `/`, or unreachable from it), from the built link graph.
7. Checks moved in (browser, `e2e/render.spec.ts`): `rendered-content` becomes the no-JS word ratio (static
   HTML vs rendered DOM, warn below 0.7; replaces the 50-word floor), `lazy-first-viewport` (warn), and
   `content-parity` (warn: a content block visible on desktop is missing on mobile, progressive disclosure
   excepted). `lazy-first-viewport` is perf; the others keep their area. Levels follow `discoveryOverrides` like every discovery rule.
8. axe's `target-size` (WCAG 2.5.8) already runs under `wcag22aa`: nothing added.
9. Stack policy `first-party-only`: every sitemap page loads only first-party resources; `allowedOrigins`
   lists the exceptions.
10. `"standard": "web-baseline"` delegates `tailwind-config`, `env-file`, `node-pin`, `posthog-secrets` and
    the PostHog layout wiring to web-baseline's `conform:check`; the contract check fails when no site check
    phase lists `conform:check`.
11. `posthog-secrets` becomes an error (exemptible), as v3 promised for v4.
12. Post-deploy keeps deploy health only: build SHA, smoke 200s, `robots.txt` and sitemaps answer 200 with the
    right type, no 403/429 to a plain request, PostHog key policy. Removed: CrUX field CWV (and the
    `crux-api-key` input), the Zaraz check, the ETag/Last-Modified warning, live Markdown negotiation, live
    Link headers, and the live re-evaluation of `robots-blocks-page`, `ai-search-crawlers` and `ai-training`.
    `markdown-negotiation` leaves the rule table; an override naming it warns and is ignored.
13. Every `verify` run writes `reports/results.json` (schema in the README); the caller `full-sweep.yml`
    uploads it as `ship-gate-results` on every run, green or red, for 35 days.
14. v4.0.0: CHANGELOG with a migration note, README tables, template pins, self-test cases for each change.

## Design
- `scripts/standards.mjs` loads the file once and exports the derived lists and a tracker matcher;
  `discovery.mjs`, `check-market.mjs` and `prepare.mjs` import it. `e2e/helpers.ts` cannot import from
  `scripts/` (it is copied into the run folder), so `prepare.mjs` writes the tracker entries into `run.json`
  and the helper matches them with the same rule (host or subdomain, a bare label, or host plus path prefix).
- Moved-in build checks join the discovery rule table (levels, overrides and the readiness report for free).
  Browser rules carry `where: 'browser'`; the build scan shows them as "browser suite".
- `e2e/page.spec.ts` is a protected test, so the browser rules go in a new spec, desktop project only, with a
  JavaScript-off context and a Pixel 7 context of its own.
- `results.mjs` runs as the action's last always-on step: it reads the step outcomes, `discovery.json`,
  `structure.json`, the render spec's per-page files, Playwright's JSON report and Lighthouse's assertion
  results, and writes `results.json`.
- Policies applied: `CLAUDE.md` (README with behaviour, CHANGELOG and pins, no local-only steps), `REVIEW.md`
  (a check that can no longer fail, a correct site that now fails), web-baseline's no-model-in-CI rule.

## Areas of concern
- **Training tokens.** `trainingOnly` adds MistralAI-Training and drops meta-externalagent and Bytespider
  from the required block list (the contract classes meta-externalagent as mixed search and training, and
  Bytespider as undocumented). A site whose robots.txt blocks today's seven tokens fails `ai-training` until
  it adds `User-agent: MistralAI-Training`. Owner: Paul. Resolved: accepted as part of the major; the
  migration note says so, and web-baseline's robots generator needs the same line.
- **Organization needs `url`.** The contract's table requires `url` on Organization (today: `name` only).
  A nested publisher Organization without `url` now fails `structured-data`. Owner: Paul. Resolved: the
  contract is the rule; the migration note says so.
- **`env-file` is never exemptible**, yet delegation skips it. Delegation is not an exemption: the check
  still runs, in web-baseline's strict allowlist, inside the same gate, and the contract check proves it is
  wired. Owner: Paul (asked for it).
- **Protected fixture tests.** `test/break-fixture.sh` and `test/expect-gate.sh` are protected, so this change
  adds no fixture variants for the new checks; self-test cases and a local run of the render spec prove them.
  New variants are a follow-up for a person to approve.
- **Turnstile and first-party-only.** Turnstile loads from `challenges.cloudflare.com`; a site on both lists
  that origin in `allowedOrigins`. The contract check says so.

## Out of scope
- website-audit's own changes (its generated copy of `standards.json`, dropping its duplicate checks, reading
  `results.json`). They land in `pauljosephdp/Skills`.
- web-baseline's robots generator and Ship Gate pin bump.
- `gate-fast.sh` (Workers Builds fast stage) writing `results.json`: it has no artifact store.
