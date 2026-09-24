# Ship Gate

The single source for the merge gate on every Gallivant Ventures portfolio site:
LowLightKing, Frame to Funnel, Playway Books, Cocoon, Qualified Deals, Portus
Immigration and FullFrameGear.

Site repos do not copy these files. They call this repo, pinned to a version.
A rule or threshold changes here once, and reaches each site through that
site's own reviewed Dependabot PR.

The standard was set from what the sites already enforce. The audit behind it,
and each site's gap to adopting it, is in
[`docs/portfolio-ci-audit-2026-09-24.md`](docs/portfolio-ci-audit-2026-09-24.md).

## What lives where

**Here, identical for every site:** stack guards, the contract check, the
client-bundle PostHog scan, the structure and placeholder scans, the Playwright
suite (axe, reflow, CSP, redirects and headers), Lighthouse standards, the
static server, the test tooling and its versions (`tools/package-lock.json`),
and the post-deploy check.

**In each site repo, small and site-specific:**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Calls `pauljosephdp/Ship-Gate@vX.Y.Z` in a job named `verify` |
| `.github/workflows/post-deploy.yml` | Calls `pauljosephdp/Ship-Gate/post-deploy@vX.Y.Z` |
| `ship-gate.config.json` | Site URL, pages, forms, the site's own checks, stricter or temporarily looser thresholds |
| `.github/dependabot.yml` | Bumps npm packages and the pinned Ship Gate version |
| `.github/pull_request_template.md` | The review checklist |

Templates for all five are in `templates/caller/`.

## The gate

`verify` runs, in order:

1. Contract and config check, then stack guards
2. `npm ci`, `astro check`, lint (if the site has `lint`), unit tests (if it has `test`)
3. Site checks before the build, then the build
4. On the built output: client-bundle PostHog scan, structure scan, placeholder
   scan, site checks after the build
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
gate that fails on runner noise is a gate that gets switched off. Playway's
measured baseline of 24 September 2026 (performance 89–96 across 37 pages)
would have failed a hard 0.90 floor on pages that are fine.

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
structure scan checks canonicals against `siteUrl` instead.

Accessibility is 1.0 because axe already fails any WCAG 2.2 AA violation, and
every measured Playway page scores 100. A site below it loosens it with a reason
and a date, like any other threshold.

Third-party code is blocked during measurement (PostHog, HubSpot, Clarity,
Google tags, Zaraz, Turnstile), so a vendor's release never moves a site's
score. `"lighthouseUrls": "all"` tests every indexable page the build emits
(not 404, noindex, meta-refresh stubs or verification files), one run each,
so a new page is gated the day it ships. A list of paths runs three times each
and takes the median.

### Browser checks

On every page in `e2ePages` (default: `pages`; `"all"` for every indexable page):

- **Smoke:** 200, one `h1`, a title and one meta description, no JS errors, no
  browser calls to PostHog.
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
  across the site; a canonical, when present, on `siteUrl`. Every file: no
  unrendered `{{token}}`. `_headers` and `_redirects` parse, with no
  merge-conflict markers. Every on-site link in `llms.txt` exists. Zero pages
  scanned is a failure.
- **Placeholder copy** (every indexable page): no `[Client name]`-style
  brackets, `TODO:`, `TBD`, `FIXME` or lorem ipsum in visible text. Citations
  like `[1]` and labels like `[PDF]` pass; `copyAllowlist` takes exact strings.
- **Client bundle:** no PostHog code or key in anything the browser downloads.

### Guards

- **PostHog is server-side only.** `posthog-node` inside `src/lib/server`,
  `src/pages/api`, `src/actions` or `src/middleware`; EU host; the key is never
  `PUBLIC_` and never hard-coded; every event is tagged with `__DEPLOY_ENV__`.
- **Every tag goes through Cloudflare Zaraz, GTM included.** No tag loads
  directly: GTM (loader URLs and inline `GTM-XXXX` container ids), Google
  Analytics, Meta, Hotjar, LinkedIn, TikTok, Microsoft Clarity, HubSpot tracking
  and HubSpot form embed scripts (`js-*.hsforms.net`) are blocked.
- **Every `<form>` has Turnstile.** A non-public form opts out with
  `<!-- turnstile-exempt: reason -->`.
- **No committed `.env` or `.dev.vars` files.** `.example` files are fine.
- **Workers config, not Pages config.**
- **Node pinned** in `.nvmrc` or `.node-version`, at 22.12.0 or later (Astro
  7's floor). A bare `22` warns: pin the exact version so CI and Workers Builds
  agree.
- **No workflow pushes to `main`.** Pushing to `main` skips the PR and its
  checks. There is no exemption; a bot opens a PR like anyone else.
- **No Cloudflare credentials in GitHub.** Workers Builds is the only deployer,
  so no workflow may use `CLOUDFLARE_API_TOKEN`, `wrangler-action`, or a
  `wrangler` write command. If one is unavoidable for now, it takes a dated
  guard exemption (below).
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
  { "guard": "posthog-client", "reason": "Moving analytics server-side in the next PR",
    "restoreBy": "2026-11-30" }
]
```

The guard then warns on every run instead of failing, until `restoreBy`, when
the build fails again. Guards: `posthog-client` (SDK, snippet, direct use
outside server paths, client bundle, browser calls), `posthog-public-var`,
`posthog-us-host`, `posthog-env-tag`, `direct-tags`, `turnstile`,
`pages-config`, `node-pin`, `cloudflare-in-workflows`, `public-lighthouse`.

Never exemptible: a hard-coded PostHog key, a committed env file, and a
workflow pushing to `main`.

## Site configuration

`ship-gate.config.json` in the site directory:

| Field | Default | Meaning |
|---|---|---|
| `siteUrl` | required | Production origin, e.g. `https://liveincocoon.com` |
| `pages` | required | One path per key template: home, service or product, contact, article |
| `formPages` | `[]` | Every page with a public form (Turnstile is checked there) |
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
| `python` | none | `{ "version": "3.11", "packages": ["fonttools"] }` for Python checks |
| `turnstileEnv` | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Env names that receive Cloudflare's always-pass test keys |
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

1. **Allow the site repos to use it.** Settings → Actions → General → Access →
   *Accessible from repositories owned by the user 'pauljosephdp'*. Without
   this, every site's `verify` fails to download the action.
2. **Protect `main`.** Settings → Rules → Rulesets: require a pull request,
   require the `self-test` check, block force pushes and deletions.
3. **Publish v1.1.0.** Releases → Draft a new release → tag `v1.1.0` on `main`.
   Site templates pin this tag. v1.0.0 was never tagged or adopted.

## What stays in the site repo

Checks about one brand or one site's content stay in the site repo and run
through `checks`: brand-token contrast, font glyph coverage, design-drift
scans, copy canon, price wording, voice lint, image budgets, motion and
navigation scripts. `docs/portfolio-ci-audit-2026-09-24.md` maps each one.

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
5. Fill in `pages` and `formPages`.
6. Keep the standard script names `check` and `build`, and `preview` if
   `server` is `preview`. Ship Gate installs its own Playwright, axe and
   Lighthouse CI; the site needs none of them for the gate.
7. Pin Node 22.12.0 or later in `.nvmrc` or `.node-version`, and set the same
   `NODE_VERSION` build variable in Workers Builds.
8. Add the two build-time markers to `astro.config.mjs`:
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
   Declare both in `src/env.d.ts`, put
   `<meta name="build-sha" content={__BUILD_SHA__} />` in the base layout
   `<head>`, and add `environment: __DEPLOY_ENV__` to every event in
   `src/lib/server/analytics.ts`. The wrapper must send nothing when
   `POSTHOG_API_KEY` is absent.
9. In the site's PostHog project, add *`environment` is not `production`* to
   the internal and test account filter, applied by default.
10. Ruleset on the site's `main`: require a pull request, require the `verify`
    check, require the branch to be up to date, block force pushes and
    deletions. Required approvals: 0 while Paul is the only committer.
11. Workers Builds: production branch `main`, non-production branch builds on,
    preview URLs on.
12. Turn on secret scanning, push protection and Dependabot alerts.

Claude Code prompt for steps 1–8:

> Adopt Ship Gate v1.1.0 in this repo following pauljosephdp/Ship-Gate README
> "Adopting it in a site repo", steps 1–8, and this site's section of
> docs/portfolio-ci-audit-2026-09-24.md. Carry every existing CI check into
> `checks` rather than dropping it. Run `npm run check` and `npm run build`
> locally, fix or list every failure, and open a PR titled "chore: adopt ship
> gate v1.1.0". Do not change deploy configuration or Cloudflare settings.

## Changing Ship Gate

Every change goes through a PR to this repo, and `self-test` must pass.
`scripts/self-test.sh` builds fixture sites at run time and proves each guard,
config rule, scan, server behaviour and generated Lighthouse setting still fires
on bad input and passes on good input. Add a case there for every new rule.

The `fixture` jobs then run the whole action, end to end, against
`test/fixture-site` (a tiny Astro site) and against copies broken one way each
by `test/break-fixture.sh`: missing alt text, a too-wide element, a CSP
violation, a dead redirect, two `h1`s, a directly loaded tag. The conforming
run must pass; each broken run must fail on the check that owns the fault.

Then publish a release. Version by effect on site repos:

- **Major** (v2.0.0): a site must change something to stay green. A new failing
  guard, a new required script, a stricter standard.
- **Minor** (v1.2.0): new warnings, new optional config, new checks that a
  conforming site already passes.
- **Patch** (v1.1.1): fixes that make no conforming site fail.

Dependabot then opens a PR in each site repo, and that PR runs through the
site's own `verify` before merging. A bad release fails on one PR instead of
breaking seven sites at once.

## Open items

- **[TO CONFIRM]** Dependabot can open Ship Gate bump PRs from a private repo
  in a personal account. If it can't, bump the pinned version by hand in each
  site's two workflow files.
- **[TO CONFIRM]** `WORKERS_CI_COMMIT_SHA` and `WORKERS_CI_BRANCH` are present
  in production builds, so the post-deploy SHA check and environment tagging
  both work.
- Pages that render on the server rather than at build time are not served by
  the `static` server. Every portfolio site builds with `output: 'static'`
  today. A site that adds server-rendered pages to `pages` sets
  `"server": "preview"`, which has not yet been proven with the Cloudflare
  adapter in CI.
- Portus Immigration and FullFrameGear have no brand review skill yet. Their PRs
  get a manual check against the brand guide.
