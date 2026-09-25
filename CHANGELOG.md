# Changelog

## v3.0.0 — 2026-09-25

AI training is off by default; every other crawler and use stays on. This is a
major release: a site whose `robots.txt` doesn't block the training crawlers
fails until it does, or until it opts in to training.

**To stay green**, add to `public/robots.txt`:

```
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: meta-externalagent
User-agent: Bytespider
Disallow: /
```

and, in the `User-agent: *` group, `Content-Signal: search=yes, ai-input=yes,
ai-train=no`. Or, to allow training, set `"discovery": { "aiTraining": "allow" }`.

**Can fail**
- `ai-training` (error, build and post-deploy): with the default
  `aiTraining: "block"`, every training token must be disallowed at `/` and a
  `Content-Signal` must not say `ai-train=yes`. With `"allow"`, none may be
  blocked and the signal must not say `ai-train=no`. Replaces the old
  "AI training crawlers blocked" note.
- `ai-uses-allowed` (error, build and post-deploy): a `Content-Signal` with
  `search=no` or `ai-input=no`.

**Warn**
- `content-signals` also warns when a signal leaves out `search`, `ai-input`
  or `ai-train`.

**Config**: new `discovery.aiTraining` (`"block"` default, or `"allow"`), in
the caller template too. Post-deploy receives it as `SHIP_GATE_AI_TRAINING`.

**Self-test**: new cases for both modes, each training token, the signal and
production robots.txt. New fixture variant `allows-training` must fail the
discovery scan.

## v2.3.1 — 2026-09-25

Faster, cheaper runs. No site needs to change anything.

**Fixed**
- The Playwright browser download is cached per Playwright version, and Python
  packages for site checks (`python.packages`) are cached too, so repeat runs
  skip both downloads.

**Ship Gate's own CI**
- The 15 fixture variants run five to a job (`fixture (1)`–`fixture (3)`)
  instead of one job each, and only after `self-test` passes.
- Pull requests skip the fixture jobs while in draft and when they change only
  Markdown outside `test/`. Pushes to `main` always run everything.

## v2.3.0 — 2026-09-25

Fixes from a review of the gate. Two rules now catch what they always claimed
to; the rest stop failing sites that are fine, or stop races.

**Can fail**
- The production-write contract now covers every script CI runs: `test`, the
  install scripts `npm ci` runs (`preinstall`, `install`, `postinstall`,
  `prepare`), and the `pre`/`post` scripts around each one. It follows `pnpm`,
  `yarn`, `run-s`, `run-p` and `npm-run-all` (globs included), and reads shell
  files a script starts. A `"postbuild": "node scripts/ping-indexnow.mjs"` now
  fails; move it to `post-deploy.yml`.
- The committed-secrets guard reads the whole repository, not only the site
  directory, so a `.env` or `.dev.vars` beside a `site/` folder now fails.

**Fixed**
- `site-entity` and `structured-data` accept every schema.org Organization and
  LocalBusiness subtype (Hotel, Resort, Dentist, Attorney, Plumber…).
- The consent check matches trackers by hostname: a site's own
  `/hubspot-partner-badge.svg` and HubSpot form embeds (`hsforms.net`) pass.
- Post-deploy: a network error reaching the Chrome UX Report API warns instead
  of failing the job.
- The summary table lists the Node pin and Ship Gate test-tool install steps,
  so a failure there no longer reads "Ship Gate passed".
- Ship Gate's own releases: two merges to `main` close together no longer
  cancel the first one's release.

**Copy into each site** (optional, from `templates/caller/`)
- `post-deploy.yml`: a `concurrency` block, so a newer merge cancels an older
  check instead of letting it fail on a healthy deploy.
- `gitignore-additions.txt`: `.lighthouseci/`.

## v2.2.0 — 2026-09-25

Agent-readiness checks: the gaps an isitagentready.com scan reported, as
discovery rules. New rules warn by default. A site whose `robots.txt` follows
RFC 9309 stays green; the ones that can fail are listed first.

**Can fail**
- `robots-txt` now fails a `robots.txt` with no `User-agent` group (it holds no
  rules). After deploy, it also fails when production serves `robots.txt` with
  a status other than 200 or 404, or not as `text/plain`.
- `content-signals-format` (error): a `Content-Signal` entry that isn't
  `search`, `ai-input` or `ai-train` set to `yes` or `no`, or one before any
  `User-agent` line.
- `sitemap-live` (error, post-deploy): every on-site sitemap named in
  production `robots.txt` answers 200 with XML that parses.

**Warn**
- `ai-crawler-rules`: no `User-agent` group names an AI crawler. Retired
  Anthropic tokens (`Claude-Web`, `anthropic-ai`) are noted.
- `content-signals`: no `Content-Signal` line.
- `sitemap-xml`: `/sitemap.xml` is neither built nor redirected.
- `link-headers`: the home page has no RFC 8288 `Link` header with rel
  `api-catalog`, `service-desc`, `service-doc` or `describedby`; checked in
  `_headers` on the PR and on the real response after deploy.
- `markdown-negotiation` (post-deploy): `Accept: text/markdown` on `/` gets
  `text/markdown`, and browsers still get HTML.

**Post-deploy**
- `check-robots-live.mjs` is now `check-live.mjs` (it keeps
  `discovery.searchCrawlers`). It honours
  `discoveryOverrides`, so a site can lower or raise the live rules like the
  build ones. Its robots crawler checks report as `robots-blocks-page` and
  `ai-search-crawlers`.

**Not added**: DNS-AID. It is an individual Internet-Draft and applies only to
sites with agent endpoints.

**Self-test**: 248 cases (was 222), including a stand-in production server for
the live checks. New fixture variant `robots-no-agents` must fail the discovery
scan.

## v2.1.0 — 2026-09-25

Closes gaps found by checking Ship Gate against a 2026 global SEO and GEO
checklist. The new rules either warn or are opt-in, with one exception:
`rtl-direction` fails, and only a page in a right-to-left language without
`dir="rtl"` can trigger it. That page is already broken for its readers.

**Discovery scan: four new rules**
- `redirect-permanence` (SEO, warn): a `_redirects` rule answering 302 or 307,
  including a rule with no status (Cloudflare's default is 302).
- `rtl-direction` (SEO, error): a page whose `lang` is a right-to-left language
  has no `dir="rtl"`.
- `hreflang-pairs` (SEO, warn): an `hreflang` alternate names a page that is
  missing from the build or doesn't link back.
- `markdown-mirrors` (GEO, warn): a Markdown or text file linked from
  `llms.txt` has no `X-Robots-Tag: noindex` or canonical `Link` header. A
  `robots.txt` Disallow does not keep a URL out of the index.
- New `discovery.searchCrawlers` setting: extra crawler tokens (`Baiduspider`,
  `Yeti`, `YandexBot`) that `robots-blocks-page` and the post-deploy
  robots.txt check must admit.

**Browser checks**
- Keyboard: Tab reaches every control, focus is never trapped, and every
  focused control is on screen and visibly changes (WCAG 2.1.2, 2.4.7,
  2.4.11). It warns by default; `"keyboard": "error"` makes it fail.
- Consent (`consent-before-tracking` policy): no non-essential cookie and no
  tracker before the visitor chooses. `consentEssentialCookies` lists the
  strictly necessary ones.

**New stack policies (off by default)**
- `market-cn`: fails when the build loads from hosts blocked in mainland China
  (Google, YouTube, Facebook, Instagram, X, Vimeo, Gravatar). Exemptible guard:
  `blocked-in-cn`.
- `rtl-logical-css`: warns on physical left/right CSS that won't mirror under
  `dir="rtl"`.
- `consent-before-tracking`: see Browser checks. Exemptible guard: `consent`.
- New "Market scan" row in the summary.

**Post-deploy**
- Fails when `/`, `/robots.txt` or a smoke path answers 403 or 429 to a plain
  request (a WAF refusing ordinary traffic refuses crawlers too).
- Warns when a page has neither `ETag` nor `Last-Modified`.
- Optional `crux-api-key` input: field Core Web Vitals (p75 LCP, INP, CLS on
  phones) from the Chrome UX Report, warn-only.

**Docs**
- README "Out of scope" section: content-quality heuristics, WAF
  configuration, legal compliance, accessibility overlays and IndexNow
  submission, each with the reason it isn't gated.
- The fixture site gains an Arabic page with hreflang pairs, a Markdown mirror
  and the new policies. The new break variants are `rtl-no-dir`, `google-font`,
  `no-focus-ring` and `tracker-cookie`.

## v2.0.0 — 2026-09-24

Ship Gate is now a generic gate for any Astro site. Vendor choices became
opt-in policies, and a new discovery scan checks SEO, AEO, GEO and AIO
readiness. This is a major release: a site must add `policies` to keep its
vendor guards, and the discovery scan fails sites that aren't yet
discoverable.

**Stack policies (breaking)**
- New `policies` config. `posthog-server-only`, `tags-via-zaraz`,
  `turnstile-forms` and `workers-builds-only` are off by default; each turns on
  its guards, scans and browser checks.
- `tags-via-zaraz` allows HubSpot form embeds (`js-*.hsforms.net`): they are
  the portfolio's form standard until HubSpot's forms API is available. HubSpot
  tracking (`hs-scripts`, `hs-analytics`) stays blocked.
- To keep the v1.1 behaviour, a site sets `"policies": ["posthog-server-only",
  "tags-via-zaraz", "turnstile-forms", "workers-builds-only"]`.
- Every site still gets the core guards: no committed env files, no workflow
  pushing to `main`, a pinned Node at or above Astro 7's floor, and no public
  Lighthouse reports.
- The client-bundle PostHog scan, the browser PostHog check, the Turnstile
  widget check, Turnstile test keys and the post-deploy PostHog check run only
  under their policy.
- An exemption for a guard whose policy is off is rejected as a no-op.
- No brand names left in the code, templates or README. The PR template is
  generic.

**Discovery scan: SEO, AEO, GEO, AIO (new, may fail)**
- `check-discovery.mjs` reads the built site and checks 23 rules:
  - robots.txt, sitemap, sitemap coverage and `lastmod`
  - canonical, `lang`, viewport and internal links
  - JSON-LD validity and key properties, the site entity and its `sameAs`
  - FAQ markup against visible text, and breadcrumbs
  - AI search and user-fetch crawler access, Open Graph, article dates and
    server-rendered text
  - `llms.txt`, and snippet and image-preview controls
- Blocking AI *training* tokens never fails. It is reported.
- `discoveryOverrides` raises a rule freely and lowers one only with a reason
  and a restore date. `discovery.sitemap` and `discovery.ignoreLinks` are new
  settings.
- A readiness table goes to the job summary and `reports/discovery.md`.
- Canonical checking moved here from the structure scan. Every indexable page
  now needs exactly one canonical.

**Post-deploy**
- New: the `robots.txt` production actually serves must not block Googlebot,
  Bingbot or an AI search crawler from a smoke path.

**Releases are automatic**: after every check passes on `main`, a `release` job
publishes the newest `CHANGELOG.md` version as a tag and GitHub release, once.

**Self-test**: 192 cases (was 115). The fixture site is discovery-ready, and
the new fixture variants `blocks-ai-search` and `bad-jsonld` must fail the
discovery scan.

## v1.1.0 — 2026-09-24

The first published release. v1.0.0 was committed but never tagged or adopted:
an audit of every portfolio repo found it would have failed every site on its
contract check before running a test. This release sets the standard from what
the sites already enforce. See `docs/portfolio-ci-audit-2026-09-24.md`.

**Works with the sites as they are**
- `working-directory` input on both actions, for sites in a subfolder (Playway).
- Node pinned in `.nvmrc` or `.node-version`.
- `lint` is optional; it runs when the site has the script.
- Ship Gate installs and pins its own Playwright 1.63.0, axe 4.13.0 and
  Lighthouse CI 0.15.1, outside the site so `astro check` never sees them.
  Sites no longer need `@playwright/test`, `@axe-core/playwright` or `@lhci/cli`.
- A built-in static server (`"server": "static"`, the default) replaces the
  dependence on `astro preview`, and finds `dist/client` from the Cloudflare
  adapter. It behaves like Workers static assets: `_redirects`, `_headers`,
  `.assetsignore` and trailing-slash redirects all apply. No `wrangler`.
- Every check runs even after another fails; a summary table names each result.
- Unit tests run when the site has a `test` script.
- `checks.preBuild`, `checks.postBuild` and `checks.browser` run a site's own
  npm scripts; all run, then all failures are reported. Optional `python` for
  Python checks.

**Lighthouse standard**
- Fail: accessibility 1.0, best practices ≥ 0.90 (was warn), CLS ≤ 0.05, and
  six SEO audits individually. `canonical` is checked by the structure scan
  instead, because every canonical fails on localhost.
- Warn: performance ≥ 0.90 (was fail), LCP ≤ 4000 ms, TBT ≤ 300 ms.
- The SEO category score is no longer asserted; Lighthouse fails it on correct
  robots.txt and noindex pages.
- `"lighthouseUrls": "all"` gates every emitted page. Third-party code is
  blocked during measurement.
- Overrides may raise any standard freely; loosening still needs a reason and
  an expiry date. v1's `category` form is still accepted; a v1 SEO override is
  now a warning and a no-op.
- `"all"` skips 404, noindex pages, meta-refresh stubs and verification files.

**Browser checks**
- axe runs WCAG 2.2 AA on the settled page (after scroll and fade-ins).
- Reflow at 320, 360 and 390px and at 200% zoom, naming the offending elements.
- CSP measured in the browser: zero violations on every page that sends one.
- Edge files: `_redirects` statuses, Locations and destinations; security
  headers; immutable `/_astro/`; the 404 page; `.assetsignore`.
- `e2ePages` (`"all"` or a list) chooses the pages. Fixed: the title check
  passed on every page, whatever its title.

**Build-output scans**
- Structure: one `h1`, heading order, `noopener`, title and description present,
  unique and within bands, canonical on `siteUrl`, no `{{tokens}}`, valid
  `_headers`/`_redirects`, `llms.txt` links resolve.
- Placeholder copy on indexable pages.

**New guards**
- Node at or above 22.12.0, Astro 7's floor.
- No workflow pushes to `main`. No exemption.
- No Cloudflare API token or `wrangler` write command in a workflow.
- No public Lighthouse report storage.
- Microsoft Clarity, HubSpot tracking and inline GTM container ids must go
  through Zaraz. HubSpot form embeds stay allowed: they are the portfolio's form
  standard until HubSpot's forms API is available.
- `guardExemptions`: any guard except a hard-coded key, a committed env file or
  a push to `main` can be exempted with a reason and a restore date. It warns
  on every run and fails again after the date.
- Warning when Dependabot and Renovate are both configured.
- The contract check refuses any `build`, `check`, `lint` script or site check
  that writes to production, following `npm run` chains and the Node files a
  script starts. `git push` and IndexNow submissions count.

**Self-test**: 115 cases (was 24), covering every rule, scan, the generated
Lighthouse config, and the static server's routing, headers, redirects and path
containment. New `fixture` jobs run the whole action against a tiny Astro site
and six broken copies of it.

## v1.0.0 — 2026-09-24 (not released)

Initial commit of the central gate, replacing the per-repo `ship-gate-kit/`
copies. Superseded by v1.1.0 before any site adopted it.
