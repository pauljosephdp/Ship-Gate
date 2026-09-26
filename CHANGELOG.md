# Changelog

## v3.5.2 — 2026-09-26

Post-deploy accepts a PostHog proxy that refuses `/static/` on purpose. No site
fails because of this release.

**Fixed**
- `check-posthog-live.mjs` failed any same-origin proxy that did not serve
  `recorder.js`. A site with session replay off can refuse `<apiHost>/static/`
  so replay, surveys and the toolbar can never load through its own origin;
  that plain-text 404 now warns. An HTML or empty 404 still fails.
- The remote config fetched through the proxy now fails when it comes back as
  HTML: the site answered, not PostHog.

## v3.5.1 — 2026-09-26

`tags-via-zaraz` and `faq-visible` no longer fail a site on text that is fine:
a tag host where nothing loads, or a FAQ question split by inline markup. No
site fails because of this release.

**Fixed**
- `direct-tags` failed on a Zaraz tool's hosts in the CSP. Clarity runs as a
  Zaraz Custom HTML tool and calls its own hosts from the browser, so the CSP
  must name `www.clarity.ms`; the guard read that as a direct load. `_headers`
  comment lines and `Content-Security-Policy` values are now skipped.
- `direct-tags` failed on a bare `www.clarity.ms` in prose, such as a cookie
  policy naming where Clarity sends data. The guard now matches Clarity's
  loader (`clarity.ms/tag`) only.
- `faq-visible` failed a FAQ question that was on the page when it contained
  inline markup: `CuSO<sub>4</sub>` read as "CuSO 4", so "CuSO4" in the JSON-LD
  never matched. The discovery scan now reads text as rendered, joining across
  inline elements (`span`, `sub`, `sup`, `a`, `em` and the rest).

## v3.5.0 — 2026-09-26

Google Analytics and PostHog can run on every page, with or without consent,
and store nothing until the visitor accepts. No site fails because of this
release. The new policy is opt-in.

**Added**
- The `analytics-always-on` policy. It needs `posthog-hybrid` (not
  `"cookieless": "off"`) and `tags-via-zaraz`. GA4 runs as a Zaraz tool with no
  consent purpose, in Google Consent Mode v2 with every signal denied by
  default. The consent test still fails a direct Google tag or a `_ga` cookie
  before consent.
- Post-deploy, with `analytics-always-on`: a warning when production's home
  page has no Zaraz loader (`/cdn-cgi/zaraz/`).
- `templates/caller/analytics/zaraz-setup.md`: the Zaraz dashboard checklist
  (GA4 tool, Consent Mode default, purposes, and a production check).
- `templates/caller/legal/analytics-disclosure.md`: cookie and privacy policy
  text for GA4 and PostHog before and after consent. Review it with counsel.

**Changed**
- `PostHogZarazConsent.astro` also sets Google Consent Mode: the analytics
  purpose's answer grants or denies `analytics_storage` through
  `zaraz.set('google_consent_update', …)`.

**Fixed**
- `PostHogZarazConsent.astro` said it needed no CSP inline allowance, but Astro
  inlines a script that small, so a CSP without `'unsafe-inline'` blocked it
  and no visitor was ever opted in. Sites using it add the `assetsInlineLimit`
  line from the README to `astro.config.mjs`.

## v3.4.1 — 2026-09-26

Dependabot can now raise the Ship Gate pin in site repos. No site fails
because of this release.

**Fixed**
- The caller `dependabot.yml` gives the `github-actions` updates a `git`
  registry for this private repo, authenticated by the Dependabot secret
  `SHIP_GATE_READ_TOKEN` (a fine-grained token with read-only Contents on
  `pauljosephdp/Ship-Gate`). Before, Dependabot's `github_actions` job in every
  site failed with "Repository not found", so the pin never moved on its own.
  Re-copy the template's `registries` block and add the secret (README →
  Adopting it in a site repo, step 14).

## v3.4.0 — 2026-09-26

Ship Gate costs sites far fewer Actions minutes and far less artifact storage.
No site fails because of this release. To get the savings, re-copy the caller
templates (`ci.yml`, `post-deploy.yml`, `dependabot.yml`, and the new
`full-sweep.yml`) and bump the pin.

**Added**
- A `stage` input on the verify action: `full` (default), `browser` (no
  Lighthouse) or `scans` (no browser, about two minutes). The caller `ci.yml`
  runs drafts at `scans` and re-runs the full gate when the PR is marked ready.
- A `sha` input on the post-deploy action: the commit production must serve.
  It defaults to the triggering commit.
- `templates/caller/.github/workflows/full-sweep.yml`: the gate against every
  page, weekly and on demand, so PR config can sample pages.

**Changed**
- Reports upload only when a check failed, and are kept 5 days instead of 14.
  Green runs upload nothing.
- Each run deletes its branch's older report artifacts, so a branch keeps at
  most its latest failed run's reports. The caller `ci.yml` and `full-sweep.yml`
  grant `actions: write` for this; without it the step logs a notice.
- The caller `post-deploy.yml` starts when Cloudflare Workers Builds reports a
  successful build of `main`, instead of polling from the push while the deploy
  runs. Sites deployed another way keep `on: push`.
- The caller `dependabot.yml` groups action updates into one PR and does not
  rebase open PRs when `main` moves.
- Site browser checks no longer reinstall Playwright's system packages when the
  test tools already did on the same runner.

**Ship Gate's own CI**
- The fixture jobs run only when a change touches what they exercise (the
  verify action, its scripts, browser tests, tools and fixtures), on pull
  requests and on pushes to `main`. Docs, `post-deploy/` and `templates/`
  changes cost about a minute.
- Fixture steps pass their stage through the new `stage` input.

## v3.3.0 — 2026-09-26

Lessons from getting `posthog-hybrid` running on Qualified Deals, moved into the
templates and checks. No site needs to change anything to stay green; bump the
pin. Sites on `posthog-hybrid` should re-copy the templates they use from
`templates/caller/posthog/`, and add `secrets.required` to their wrangler config.

**Added**
- Proxy in the Worker entry: `src/lib/server/posthog-proxy.ts` (a pure function,
  unit-tested in `test/posthog-proxy.test.mjs`) and `src/worker.ts`. It serves
  `/ph` by default: `/ph/static/*` and `/ph/array/*` go to
  `eu-assets.i.posthog.com`, the rest to `eu.i.posthog.com`. It drops the site's
  cookies and PostHog's `Set-Cookie`, and forwards `CF-Connecting-IP` as
  `X-Forwarded-For`. It needs no on-demand rendering and isn't redirected by
  `trailingSlash: 'always'`.
- `optional/src/components/PostHogZarazConsent.astro`: syncs Zaraz consent
  into PostHog's opt-in or opt-out. It does nothing until
  `zaraz.consent.APIReady`, so a returning visitor who said yes isn't opted out
  on first paint.
- `optional/src/lib/hubspot-conversion.ts`: a HubSpot embed submission
  (`hsFormCallback`/`onFormSubmitted`) goes to `zaraz.track` and
  `posthog.capture` with the form ID only.
- `posthog-hybrid` warns when the wrangler config's `secrets.required` lacks
  `POSTHOG_API_KEY` or, with `turnstile-forms`, the `turnstileEnv` secret. This
  becomes an error in v4.
- Post-deploy with a proxy path: `<siteUrl><apiHost>/static/recorder.js` must
  answer 200 with a JavaScript content type.
- README: where each key goes, the PostHog project settings (cookieless server
  hash mode 2), the unconfirmed consent-copy caveat on session replay, and
  one-use Turnstile tokens.

**Fixed**
- `PostHog.astro` and `PostHogSnippet.astro` register `environment` again
  after `opt_in_capturing()` and `opt_out_capturing()`. Opting in moved
  posthog-js to cookie storage and dropped the tag, so every event after
  consent went untagged and slipped past the "not production" filter.
- `analytics.ts`:
  - finds the visitor from the tracing headers, then ids sent in the form body
    (`browserIds(body)`), then the cookie's `distinct_id` and `$sesid[1]`
  - with no identity at all, uses a random id with
    `$process_person_profile: false`, not one shared `'server'` person
  - trims the key, logs each send (key prefix and length) and PostHog's own
    errors, and when the key is missing warns once with the binding names
    (never their values)

**Removed**
- `optional/src/pages/api/ingest/[...path].ts`, replaced by the Worker-entry
  proxy. A site that copied it keeps working; move to `/ph` when convenient.

## v3.2.1 — 2026-09-26

A fix for sites on `posthog-hybrid` with a same-origin proxy
(`posthog.apiHost` a path such as `"/ph"` or `"/api/ingest"`). Sites on EU
Cloud (`"https://eu.i.posthog.com"`) need nothing; bump the pin.

**Fixed**
- The browser tests abort PostHog requests to the proxy path, as they already
  did for PostHog's own hosts. Before, the static server answered them with an
  HTML page, the browser refused to run it as a script, and every page failed
  "no JS errors" on the SDK's lazily loaded extensions
  (`/ph/static/…/web-vitals-with-attribution.js`, `/ph/array/…/config.js`).
  Found on Qualified Deals. PostHog's requests are still recorded before the
  abort, so "PostHog on every page" keeps proving the attempt.

## v3.2.0 — 2026-09-25

A new opt-in stack policy, `posthog-hybrid`: PostHog in the browser on every
page and on the server, every feature on. No site needs to change anything;
bump the pin.

**Added**
- `posthog-hybrid` policy. Guards: `posthog-node` is a dependency and stays in
  server paths; a component in `src` calls `posthog.init(` and registers
  `environment: __DEPLOY_ENV__`; with `"embed": "npm"`, `posthog-js` is a
  dependency; only `PUBLIC_POSTHOG_KEY` is public (no `PUBLIC_POSTHOG_*PERSONAL*`
  or `*SECRET*`); EU host; no hard-coded `phc_`/`phx_` key (never exempt).
- `posthog` config: `embed` (`"snippet"` or `"npm"`), `cookieless`
  (`"on_reject"`, `"always"` or `"off"`) and `apiHost` (EU Cloud or a
  same-origin proxy path). `"off"` together with `consent-before-tracking` is
  refused. `posthog-hybrid` and `posthog-server-only` can't be combined.
- The build gets Ship Gate's CI-only PostHog key in `PUBLIC_POSTHOG_KEY`, so no
  real key is needed in GitHub.
- PostHog scan (`scripts/check-posthog.mjs`, "PostHog on every page"): the key
  on every indexable page, inline or in a script the page loads; no other key
  and no personal key in client output; every CSP allows PostHog's hosts,
  `blob:` workers and, for the snippet, `'unsafe-inline'`.
- Browser checks: every page reaches PostHog and defines `window.posthog`; with
  the npm embed, the SDK is loaded, capturing before consent, in the configured
  cookieless mode. Under `consent-before-tracking`, cookieless PostHog may load
  before consent but stores nothing, and (npm, `on_reject`) starts storing once
  the visitor opts in.
- Post-deploy (`scripts/check-posthog-live.mjs`): production's home page starts
  PostHog with a key PostHog knows, never the CI key or a personal key.
- `templates/caller/posthog/`: the options file, the npm and snippet
  components, the `posthog-node` wrapper (events, error tracking, feature flags,
  joined to the browser session), `env.d.ts`, the CSP sources, and an optional
  `/api/ingest` reverse proxy.
- Fixture variants `posthog-hybrid` (must pass), `posthog-hybrid-missing` and
  `posthog-hybrid-csp` (must fail the PostHog scan), built from the templates.
- New exemptible guards `posthog-missing`, `posthog-server` and `posthog-csp`;
  `posthog-public-var`, `posthog-us-host` and `posthog-env-tag` now belong to
  both PostHog policies.

## v3.1.0 — 2026-09-25

A third AI-training policy, and two false positives fixed. No site needs to
change anything; bump the pin.

**Added**
- `discovery.aiTraining: "reserve"`: training crawlers may fetch, and training
  is reserved by signal instead. `ai-training` fails unless every training
  token (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot,
  meta-externalagent, Bytespider) that can fetch `/` is governed by a group
  whose `Content-Signal` says `ai-train=no`: its own named group, or `*` when it
  has none. A governing group with no `ai-train` signal fails, and any
  `ai-train=yes` fails. A token disallowed from `/` passes (stricter is
  allowed). Applies in the build discovery scan and the post-deploy robots.txt
  check. For sites such as Cocoon and Playway that let training crawlers fetch
  with `Content-Signal: search=yes, ai-input=yes, ai-train=no` on every group,
  backed by their terms.

**Fixed**
- The contract check no longer flags a production write named only in a
  comment. Node files a script starts lose their `/* … */` and `//` comments
  (never a URL's `//` or anything in a string), and shell files their
  whole-line and trailing ` #` comments, before matching. Found on Cocoon, whose
  `scripts/install-markdown-negotiation.mjs` mentions `wrangler deploy` in a
  JSDoc line. `execSync('wrangler deploy')` and IndexNow calls in code are still
  caught.
- `posthog-server-only` no longer flags a privacy policy that names PostHog.
  Markdown content under `src/content` (`*.md`, `*.mdx`) may say
  `posthog.com/privacy`; `posthog-node`, `POSTHOG_`, `new PostHog(`,
  `posthog.init` and ingestion hosts (`i.posthog.com`, `eu.i.posthog.com`,
  `us-assets.i.posthog.com`) still fail there. `self-test` now proves the
  disclosure also passes the client-bundle and production-HTML checks, and that
  an ingestion host or `posthog-js` still fails them. Found on Cocoon's
  `src/content/pages/privacy-policy.mdx`.

## v3.0.3 — 2026-09-25

Ship Gate's own CI spends fewer Actions minutes again. No site needs to change
anything; a site calling the action installs and checks exactly as before.

**Ship Gate's own CI**
- Within a fixture job only the first variant installs. Later variants reuse
  the fixture's and the test tools' `node_modules` and skip the npm and
  Playwright cache restores. This is honoured only when the action runs from
  this repo's own checkout.
- The `release` job starts a runner only when `CHANGELOG.md` names a version
  that has no GitHub release yet.
- Dependabot groups each ecosystem's updates into one PR and no longer rebases
  open PRs whenever `main` moves.
- Pull requests are opened as drafts and marked ready once, so the fixture jobs
  run once per finished change.

## v3.0.2 — 2026-09-25

The post-deploy check could fail on a healthy deploy and pass on a bad one. No
site needs to change anything; bump the pin.

**Fixed**
- **Wait for production to serve this commit** never succeeded once production
  did serve it. It piped `curl` into `grep -q` under the runner's `pipefail`:
  `grep` exits on the first match, `curl` then fails writing the rest of the
  page (exit 23), and the pipeline reads the match as a miss. Every post-deploy
  run on a site with a large home page timed out and skipped every later step.
  Found on Qualified Deals, whose home page is about 80 KB.
- **Production HTML is PostHog-free** had the same pipeline the other way round:
  a match could read as a pass. It now also fails when the page can't be
  fetched, rather than reporting it PostHog-free.
- Both steps now fetch the page into a variable and search that. `self-test`
  fails if either action pipes `curl` into `grep -q` again.
- The caller template's `post-deploy.yml` comment no longer names a `wrangler`
  write command, which the `workers-builds-only` guard flagged in every site
  that copied it.

## v3.0.1 — 2026-09-25

Ship Gate's own CI costs about a quarter of the Actions minutes it did. No site
needs to change anything; sites run every check exactly as before.

**Fixed**
- The Playwright system packages install once per runner. A second gate run in
  the same job skips the apt step.

**Ship Gate's own CI**
- Each fixture variant stops at the stage that owns its fault: scan faults never
  start a browser, browser faults skip Lighthouse, and only the conforming run
  does everything. The stage is honoured only when the action runs from this
  repo's own checkout.
- Two fixture jobs, `fixture (browser)` and `fixture (scans)`, instead of four.
- A push to `main` skips the fixture jobs when its pull request already passed
  them on the exact same tree; the release still waits for `self-test`.

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
