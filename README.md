# Ship Gate

One merge gate for any Astro site: accessibility, performance, security
headers, and whether search engines, answer engines and AI assistants can
find, read and cite the site (SEO, AEO, GEO and AIO readiness).

Site repos do not copy these files. They call this repo, pinned to a version.
A rule or threshold changes here once, and reaches each site through that
site's own reviewed Dependabot PR.

The core gate makes no vendor choices for a site. Opinions about which vendors
a site uses (analytics, tag management, bot protection, deploy pipeline) are
**stack policies**, off by default; a site or a portfolio opts in by name.

## What lives where

**Here, identical for every site:** stack guards, the contract check, the
structure, placeholder and discovery scans, the opt-in stack policies, the Playwright
suite (axe, reflow, CSP, redirects and headers), Lighthouse standards, the
static server, the test tooling and its versions (`tools/package-lock.json`),
and the post-deploy check.

**In each site repo, small and site-specific:**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Calls `pauljosephdp/Ship-Gate@vX.Y.Z` in a job named `verify` |
| `.github/workflows/post-deploy.yml` | Calls `pauljosephdp/Ship-Gate/post-deploy@vX.Y.Z` |
| `ship-gate.config.json` | Site URL, pages, policies, the site's own checks, stricter or temporarily looser thresholds |
| `.github/dependabot.yml` | Bumps npm packages and the pinned Ship Gate version |
| `.github/pull_request_template.md` | The review checklist |

Templates for all five are in `templates/caller/`.

## The gate

`verify` runs, in order:

1. Contract and config check, then stack guards
2. `npm ci`, `astro check`, lint (if the site has `lint`), unit tests (if it has `test`)
3. Site checks before the build, then the build
4. On the built output: structure scan, discovery scan (SEO, AEO, GEO, AIO),
   placeholder scan, the client-bundle PostHog scan (`posthog-server-only`
   policy), site checks after the build
5. Against the served build: site browser checks, then the Playwright suite
   (smoke + axe on desktop 1440 and Pixel 7, reflow, CSP, edge files)
6. Lighthouse CI (mobile)

Every check runs even after another fails, so a PR shows all its failures at
once; checks that need the build skip when the build fails. A summary table at
the end names each check's result, and the job fails if any check failed.
Reports upload as a build artifact for 14 days, never to public storage.

The built site is served by `scripts/serve-static.mjs`, which behaves like
Cloudflare Workers static assets: it applies `_redirects` and `_headers`, hides
`.assetsignore` files, and redirects `/about` to `/about/` as Workers does. So
CSP, security headers and redirects are tested on the PR, not discovered in
production. Nothing in the gate runs `wrangler`: some site configs run a remote
migration whenever wrangler starts.

### Lighthouse standard

Deterministic lab signals fail the build. Throttled performance on a shared CI
runner moves several points between identical runs, so performance warns: a
gate that fails on runner noise is a gate that gets switched off. One measured
baseline of 24 September 2026 (performance 89–96 across 37 identical-quality
pages) would have failed a hard 0.90 floor on pages that are fine.

| Audit | Standard | Enforcement |
|---|---|---|
| Accessibility score | 1.0 | fail |
| Best Practices score | ≥ 0.90 | fail |
| Cumulative Layout Shift | ≤ 0.05 | fail |
| `document-title`, `meta-description`, `http-status-code`, `link-text`, `crawlable-anchors`, `hreflang` | pass | fail |
| Performance score | ≥ 0.90 | warn |
| Largest Contentful Paint | ≤ 4000 ms | warn |
| Total Blocking Time | ≤ 300 ms | warn |

The SEO category score is not asserted. Lighthouse fails `robots-txt` on the
Content-Signal directive (a deliberate `ai-train=no`) and `is-crawlable` on
deliberate noindex pages, so the category would fail correct sites. The SEO
audits that matter are asserted one by one instead. `canonical` is not asserted
either: served from localhost, every canonical points at another origin. The
discovery scan checks canonicals against `siteUrl` instead.

Accessibility is 1.0 because axe already fails any WCAG 2.2 AA violation, and
well-built pages score 100. A site below it loosens it with a reason
and a date, like any other threshold.

Third-party code is blocked during measurement (PostHog, HubSpot, Clarity,
Google tags, Zaraz, Turnstile), so a vendor's release never moves a site's
score. `"lighthouseUrls": "all"` tests every indexable page the build emits
(not 404, noindex, meta-refresh stubs or verification files), one run each,
so a new page is gated the day it ships. A list of paths runs three times each
and takes the median.

### Browser checks

On every page in `e2ePages` (default: `pages`; `"all"` for every indexable page):

- **Smoke:** 200, one `h1`, a title and one meta description, no JS errors.
  With `posthog-server-only`, no browser calls to PostHog; with
  `turnstile-forms`, a Turnstile widget on every `formPages` page.
- **axe, WCAG 2.2 AA** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`),
  desktop and mobile, after scrolling the page and letting fade-in animations
  finish, so a card mid-fade is not scanned.
- **Reflow:** no horizontal scroll at 320, 360 and 390px and at 200% zoom
  (1280px at 2x), WCAG 1.4.10 and 1.4.4. Content inside its own `overflow-x`
  scroller or clipper passes; the failure names the elements past the edge.
- **CSP:** a page that sends a Content-Security-Policy (enforced or Report-Only)
  must load with zero violations.

Other origins are blocked in the browser, so a vendor outage never fails a PR.
CSP still reports a disallowed URL before any request is made.

Once per run, the **edge** checks: every static `_redirects` rule answers with
its status and `Location`; every on-site destination answers 200 (no chains);
the home page sends `securityHeaders` (default `X-Content-Type-Options`,
`Referrer-Policy`, and `X-Frame-Options` or CSP `frame-ancestors`); `/_astro/`
assets are `immutable`; an unknown path answers 404 with the site's 404 page;
`.assetsignore` files are not served.

### Build-output scans

- **Structure** (every indexable page): exactly one `h1`; no skipped heading
  levels; `target="_blank"` carries `rel="noopener"`; a title (at most 75
  characters, or the site's `structure` band) and meta description, each unique
  across the site. Every file: no
  unrendered `{{token}}`. `_headers` and `_redirects` parse, with no
  merge-conflict markers. Every on-site link in `llms.txt` exists. Zero pages
  scanned is a failure.
- **Placeholder copy** (every indexable page): no `[Client name]`-style
  brackets, `TODO:`, `TBD`, `FIXME` or lorem ipsum in visible text. Citations
  like `[1]` and labels like `[PDF]` pass; `copyAllowlist` takes exact strings.
- **Client bundle** (`posthog-server-only` policy): no PostHog code or key in
  anything the browser downloads.

### Discovery scan: SEO, AEO, GEO and AIO readiness

Whether search engines, answer engines and AI assistants can crawl the site,
understand it and quote it. It reads the built output (no browser, no network),
so it runs in seconds on every page and gives the same answer every run.

The four terms overlap, so each rule sits under the one it matters most to:

- **SEO**: search engines can crawl and index every page.
- **AEO** (answer engine optimisation): the page states its facts as
  schema.org JSON-LD, which answer engines and rich results read.
- **GEO** (generative engine optimisation): AI assistants such as ChatGPT,
  Claude and Perplexity can reach the page, read it without running JavaScript,
  and cite it with a title, summary and image.
- **AIO** (AI Overviews): Google's AI Overviews and AI Mode draw on the normal
  Search index, so a page qualifies by being indexed and snippet-eligible. Google
  documents no extra markup for them.

| Area | Rule | Default | Fails when |
|---|---|---|---|
| SEO | `robots-txt` | error | no `robots.txt` in the build, or a line that doesn't parse |
| SEO | `robots-sitemap` | error | `robots.txt` has no `Sitemap:` line on `siteUrl` |
| SEO | `robots-blocks-page` | error | an indexable page is disallowed for Googlebot or Bingbot |
| SEO | `sitemap` | error | no sitemap, or it doesn't parse, lists another origin, or has a malformed `lastmod`; sitemap indexes are followed |
| SEO | `sitemap-coverage` | error | an indexable, self-canonical page is missing, or the sitemap lists a noindex, redirecting, canonicalised or missing URL |
| SEO | `sitemap-lastmod` | warn | a URL has no `lastmod`, or one in the future |
| SEO | `canonical` | error | not exactly one canonical, not on `siteUrl`, or it names a URL that redirects or is not an indexable page |
| SEO | `html-lang` | error | `<html>` has no valid `lang` |
| SEO | `viewport` | error | no `width=device-width` viewport |
| SEO | `internal-links` | error | an `<a href>` on the site resolves to no built file and no `_redirects` rule |
| AEO | `structured-data` | error | JSON-LD doesn't parse, lacks a schema.org `@context` or `@type`, or lacks key properties (below) |
| AEO | `site-entity` | error | the home page declares no Organization, LocalBusiness or Person, or its `url` is off-site |
| AEO | `entity-sameas` | warn | that entity has no `sameAs` profile links |
| AEO | `faq-visible` | error | a FAQPage question is not visible on the page (structured data must describe visible content) |
| AEO | `breadcrumbs` | warn | a page two or more levels deep has no BreadcrumbList |
| GEO | `ai-search-crawlers` | error | `robots.txt` blocks an AI search or user-fetch crawler from an indexable page: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Applebot, DuckAssistBot |
| GEO | `open-graph` | error | no `og:title`, `og:description` or absolute `og:image`, an `og:image` on the site that the build lacks, or an off-site `og:url` |
| GEO | `article-dates` | warn | an Article has no `dateModified` |
| GEO | `rendered-content` | warn | fewer than 50 words of text in the HTML (content rendered by JavaScript) |
| GEO | `llms-txt` | warn | no `/llms.txt` |
| GEO | `llms-txt-format` | error | `/llms.txt` lacks the `# Name` heading, `> summary` line or links ([llmstxt.org](https://llmstxt.org)) |
| AIO | `snippet-controls` | warn | an indexable page sets `nosnippet` or `max-snippet:0` |
| AIO | `image-preview` | warn | an indexable page sets `max-image-preview:none` |

**Key properties** checked by `structured-data`: Article types need
`headline`, `datePublished` and `author`. Organization and Person need `name`,
and LocalBusiness types need `name` and `address`. WebSite needs `name` and
`url`. Product needs `name` plus `offers`, `review` or `aggregateRating`. Event
needs `name`, `startDate` and `location`. FAQPage needs Questions with
`acceptedAnswer.text`, and BreadcrumbList needs `position`, `name` and `item`.
Recipe and VideoObject get Google's required properties. Where Google defines
required properties, these match them; otherwise they are the minimum that
identifies the thing.

**Training is a separate choice.** Blocking model-training tokens (GPTBot,
ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent,
Bytespider) never fails the gate; the scan only reports which ones are blocked.
Google-Extended does not affect Google Search or AI Overviews. Blocking a
*search* crawler such as OAI-SearchBot or PerplexityBot removes the site from
that product's answers, so it fails.

**What it does not claim.** `llms.txt` is a proposal: some AI tools read it,
but Google Search does not use it, so it only warns. No markup guarantees a
citation in an AI answer; these rules make sure nothing on the site prevents
one.

The result table goes to the job summary and `reports/discovery.md` in the
build artifact. Error findings fail the step and warnings are annotated.
`discoveryOverrides` raises or lowers a rule, the same way thresholds are
overridden:

```json
"discoveryOverrides": [
  { "rule": "llms-txt", "level": "error" },
  { "rule": "open-graph", "level": "warn",
    "reason": "Social images ship with the redesign", "restoreBy": "2026-12-31" }
]
```

After deploy, the post-deploy action reads the `robots.txt` production
**actually serves** and fails if it blocks Googlebot, Bingbot or an AI search
crawler from a smoke path. A CDN's managed robots.txt or "block AI bots" setting
can rewrite the file after the build passed.

### Stack policies

Off unless the site lists them in `policies`. Each one turns on its guards and
checks:

| Policy | What it enforces |
|---|---|
| `posthog-server-only` | `posthog-node` only inside `src/lib/server`, `src/pages/api`, `src/actions` or `src/middleware`; EU host; the key is never `PUBLIC_` and never hard-coded; every event tagged with `__DEPLOY_ENV__`; no PostHog in the client bundle, in browser requests, or in production HTML |
| `tags-via-zaraz` | No tag loads directly. GTM (loader URLs and inline `GTM-XXXX` ids), Google Analytics, Meta, Hotjar, LinkedIn, TikTok, Microsoft Clarity and HubSpot scripts go through Cloudflare Zaraz |
| `turnstile-forms` | Every `<form>` carries Cloudflare Turnstile (a non-public form opts out with `<!-- turnstile-exempt: reason -->`), and the widget renders on every `formPages` page. The site's Turnstile env vars get Cloudflare's always-pass test keys |
| `workers-builds-only` | No Pages config (`pages_build_output_dir`), and no workflow holds a Cloudflare API token or runs a `wrangler` write. Workers Builds is the only deployer |

```json
"policies": ["posthog-server-only", "tags-via-zaraz", "turnstile-forms", "workers-builds-only"]
```

A portfolio that shares a stack puts the same list in every site's config.

### Guards

These apply to every site:

- **No committed `.env` or `.dev.vars` files.** `.example` files are fine.
- **Node pinned** in `.nvmrc` or `.node-version`, at 22.12.0 or later (Astro
  7's floor). A bare `22` warns: pin the exact version so CI and Workers Builds
  agree.
- **No workflow pushes to `main`.** Pushing to `main` skips the PR and its
  checks. There is no exemption; a bot opens a PR like anyone else.
- **Lighthouse reports stay private.** Temporary public storage fails.
- **One dependency bot.** Dependabot and Renovate together warn: every update
  would arrive twice.

The contract check also refuses any `build`, `check`, `lint` script or site
check that writes to production: `wrangler deploy`/`secret`/`versions deploy`,
R2 or KV writes, `--remote`, remote migrations, `git push`, IndexNow
submissions. It follows `npm run` chains and reads the Node files a script
starts, so `"verify": "npm run deploy"` is caught too. CI builds every PR; a
merge gate must be read-only.

### Guard exemptions

A site that breaks a guard today can adopt the gate now and fix it on a
deadline:

```json
"guardExemptions": [
  { "guard": "node-pin", "reason": "Node upgrade lands with the Astro bump",
    "restoreBy": "2026-11-30" }
]
```

The guard then warns on every run instead of failing, until `restoreBy`, when
the build fails again. Core guards: `node-pin`, `public-lighthouse`. Policy
guards, exemptible only when the site uses the policy:

- `posthog-server-only`: `posthog-client` (SDK, snippet, direct use outside
  server paths, client bundle, browser calls), `posthog-public-var`,
  `posthog-us-host` and `posthog-env-tag`
- `tags-via-zaraz`: `direct-tags`
- `turnstile-forms`: `turnstile`
- `workers-builds-only`: `pages-config` and `cloudflare-in-workflows`

Never exemptible: a committed env file, a workflow pushing to `main`, and (with
`posthog-server-only`) a hard-coded PostHog key.

## Site configuration

`ship-gate.config.json` in the site directory:

| Field | Default | Meaning |
|---|---|---|
| `siteUrl` | required | Production origin, e.g. `https://example.com` |
| `pages` | required | One path per key template: home, service or product, contact, article |
| `policies` | `[]` | Stack policies this site follows; see Stack policies |
| `formPages` | `[]` | Every page with a public form (the `turnstile-forms` policy checks the widget there) |
| `smokePaths` | `/`, `/robots.txt`, `/sitemap-index.xml` | Checked on production after deploy |
| `server` | `static` | `static` serves the built files (handles `dist/client` from the Cloudflare adapter); `preview` runs `npm run preview` |
| `distDir` | `dist` | The build output folder |
| `lighthouseUrls` | same as `pages` | A list of paths, or `"all"` for every indexable page the build emits |
| `e2ePages` | same as `pages` | Pages for smoke, axe, reflow and CSP; a list or `"all"` |
| `lighthouseBlockedUrls` | `[]` | Extra URL patterns to block during Lighthouse, e.g. `"*/relay/*"` |
| `structure` | `{ "titleMax": 75 }` | Title and description bands: `titleMin`, `titleMax` (≤ 75), `descMin`, `descMax` |
| `copyAllowlist` | `[]` | Exact strings the placeholder scan allows, e.g. `"[Your Name]"` |
| `securityHeaders` | see Browser checks | Headers the home page must send; add to the list, never remove |
| `reflowWidths` | `[320, 360, 390]` | Narrow widths for the reflow check; must include 320 |
| `checks.preBuild` | `[]` | npm script names to run before the build (`test` already runs if present) |
| `checks.postBuild` | `[]` | npm script names to run against the built output |
| `checks.browser` | `[]` | npm script names run against the served build; they get `SHIP_GATE_BASE_URL` and `BASE_URL`, and use the site's own Playwright |
| `guardExemptions` | `[]` | See Guard exemptions |
| `discoveryOverrides` | `[]` | Raise or lower a discovery rule; see Discovery scan |
| `discovery.sitemap` | from `robots.txt`, else `/sitemap-index.xml` or `/sitemap.xml` | The sitemap's path |
| `discovery.ignoreLinks` | `[]` | Path prefixes the Worker serves rather than the static build, e.g. `"/api/"`; the link check skips them |
| `python` | none | `{ "version": "3.11", "packages": ["fonttools"] }` for Python checks |
| `turnstileEnv` | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | With `turnstile-forms`: env names that receive Cloudflare's always-pass test keys |
| `thresholdOverrides` | `[]` | See below |

Site checks are npm script names only, never raw commands. A check that needs
arguments gets its own script, e.g. `"lastmod:check": "node scripts/gen-lastmod.mjs --check"`.

## Threshold overrides

A site may make any standard **stricter** with no reason needed:

```json
"thresholdOverrides": [
  { "audit": "categories:performance", "level": "error" },
  { "audit": "categories:accessibility", "minScore": 1 },
  { "audit": "categories:best-practices", "minScore": 1 }
]
```

A site may make one **looser** only with a reason and a restore date:

```json
"thresholdOverrides": [
  { "audit": "largest-contentful-paint", "maxNumericValue": 5000,
    "reason": "Hero video pending re-encode", "restoreBy": "2026-12-31" }
]
```

The gate rejects a loosening with no reason, one past its restore date, one
that changes nothing, and any audit not in the standard. An expired override
fails the build until the standard is restored or the override is renewed.
The v1 form `{ "category": "performance", ... }` is still accepted.

## One-time setup of this repo

1. **Allow the site repos to use it** (only while this repo is private).
   Settings → Actions → General → Access → *Accessible from repositories
   owned by* this account or organisation. Without this, every site's `verify`
   fails to download the action.
2. **Protect `main`.** Settings → Rules → Rulesets: require a pull request,
   require the `self-test` check, block force pushes and deletions.
3. **Publish the release.** Releases → Draft a new release → tag `v2.0.0` on
   `main`. Site templates pin this tag.

## What stays in the site repo

Checks about one brand or one site's content stay in the site repo and run
through `checks`: brand-token contrast, font glyph coverage, design-drift
scans, copy canon, price wording, voice lint, image budgets, motion and
navigation scripts. Ship Gate never learns a brand's name, colours or voice.
(`docs/portfolio-ci-audit-2026-09-24.md` is the dated audit of the first
portfolio that adopted the gate, kept as history.)

Never in the gate, whatever the site: deploys, `wrangler` against production,
remote D1 migrations, R2 or KV writes, Worker secrets, IndexNow submissions,
content syncs that commit, and paid API calls. Checks against production
belong in `post-deploy.yml` or a scheduled workflow.

## Adopting it in a site repo

1. Copy `templates/caller/` into the repo. The workflows and `dependabot.yml`
   go at the repo root; `ship-gate.config.json` goes in the site directory. Add
   `gitignore-additions.txt` to the site's `.gitignore`.
2. If the site is not at the repo root, set `working-directory` in both
   workflow files and the npm `directory` in `dependabot.yml`.
3. Delete what Ship Gate now owns: old kit copies (`scripts/guards.sh`,
   `scripts/check-dist.sh`) and the site's own `lighthouserc.*`. Move any
   stricter Lighthouse thresholds into `thresholdOverrides` first.
4. Move the site's existing CI checks into `checks`, then delete the old
   workflow steps they replace. Keep scheduled operational workflows (IndexNow,
   content sync) as they are, unless a guard flags them.
5. Fill in `pages`, and `policies` if the site follows any stack policy
   (`formPages` too with `turnstile-forms`).
6. Make the site discoverable, or the discovery scan lists what is missing: a
   `robots.txt` with a `Sitemap:` line, a sitemap (`@astrojs/sitemap`), one
   canonical, Open Graph tags and `lang` in the base layout, and Organization or
   Person JSON-LD on the home page. Run the scan locally (below) before the
   first PR.
7. Keep the standard script names `check` and `build`, and `preview` if
   `server` is `preview`. Ship Gate installs its own Playwright, axe and
   Lighthouse CI; the site needs none of them for the gate.
8. Pin Node 22.12.0 or later in `.nvmrc` or `.node-version`, and set the same
   `NODE_VERSION` build variable in Workers Builds.
9. Add the build-time markers to `astro.config.mjs`:
   ```js
   vite: {
     define: {
       __BUILD_SHA__: JSON.stringify(process.env.WORKERS_CI_COMMIT_SHA ?? 'local'),
       __DEPLOY_ENV__: JSON.stringify(
         process.env.WORKERS_CI_BRANCH === 'main' ? 'production'
           : process.env.WORKERS_CI ? 'preview' : 'local'),
     },
   },
   ```
   Declare both in `src/env.d.ts` and put
   `<meta name="build-sha" content={__BUILD_SHA__} />` in the base layout
   `<head>`. With `posthog-server-only`, also add `environment: __DEPLOY_ENV__`
   to every event in `src/lib/server/analytics.ts`; the wrapper must send
   nothing when `POSTHOG_API_KEY` is absent.
10. With `posthog-server-only`, in the site's PostHog project, add *`environment` is not `production`* to
   the internal and test account filter, applied by default.
11. Ruleset on the site's `main`: require a pull request, require the `verify`
    check, require the branch to be up to date, block force pushes and
    deletions. Required approvals: 0 while one person is the only committer.
12. Workers Builds: production branch `main`, non-production branch builds on,
    preview URLs on.
13. Turn on secret scanning, push protection and Dependabot alerts.

Claude Code prompt for steps 1–9:

> Adopt Ship Gate v2.0.0 in this repo following pauljosephdp/Ship-Gate README
> "Adopting it in a site repo", steps 1–9. Carry every existing CI check into
> `checks` rather than dropping it. Run `npm run check` and `npm run build`
> locally, then the discovery scan, and fix or list every failure. Open a PR
> titled "chore: adopt ship gate v2.0.0". Do not change deploy configuration
> or Cloudflare settings.

Run the discovery scan locally after `npm run build`, from the site directory,
with a checkout of Ship Gate beside it:

```sh
node ../Ship-Gate/scripts/prepare.mjs after-build && node ../Ship-Gate/scripts/check-discovery.mjs
```

## Changing Ship Gate

Every change goes through a PR to this repo, and `self-test` must pass.
`scripts/self-test.sh` builds fixture sites at run time and proves each guard,
config rule, scan, server behaviour and generated Lighthouse setting still fires
on bad input and passes on good input. Add a case there for every new rule.

The `fixture` jobs then run the whole action, end to end, against
`test/fixture-site` (a tiny Astro site) and against copies broken one way each
by `test/break-fixture.sh`: missing alt text, a too-wide element, a CSP
violation, a dead redirect, two `h1`s, a directly loaded tag, an AI search
crawler blocked in `robots.txt`, invalid JSON-LD. The conforming
run must pass; each broken run must fail on the check that owns the fault.

Then publish a release. Version by effect on site repos:

- **Major** (v2.0.0): a site must change something to stay green. A new failing
  guard, a new required script, a stricter standard.
- **Minor** (v1.2.0): new warnings, new optional config, new checks that a
  conforming site already passes.
- **Patch** (v1.1.1): fixes that make no conforming site fail.

Dependabot then opens a PR in each site repo, and that PR runs through the
site's own `verify` before merging. A bad release fails on one PR instead of
breaking every site at once.

## Open items

- **[TO CONFIRM]** Dependabot can open Ship Gate bump PRs from a private repo
  in a personal account. If it can't, bump the pinned version by hand in each
  site's two workflow files.
- **[TO CONFIRM]** `WORKERS_CI_COMMIT_SHA` and `WORKERS_CI_BRANCH` are present
  in production builds, so the post-deploy SHA check and environment tagging
  both work.
- The discovery scan reads the static build. Pages rendered on request by the
  Worker are outside it: list their prefixes in `discovery.ignoreLinks`, and
  cover them with a site browser check.
- Pages that render on the server rather than at build time are not served by
  the `static` server, which serves only what `output: 'static'` emits. A site that adds server-rendered pages to `pages` sets
  `"server": "preview"`, which has not yet been proven with the Cloudflare
  adapter in CI.
