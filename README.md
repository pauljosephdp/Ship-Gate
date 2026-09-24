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
client-bundle PostHog scan, the Playwright + axe smoke test, Lighthouse
standards, the test tooling and its versions, and the post-deploy check.

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

`verify` runs, in order: stack guards → contract check → `npm ci` →
`astro check` → lint (if the site has a `lint` script) → site checks before the
build → build → client-bundle PostHog scan → site checks after the build →
site browser checks → Playwright + axe (desktop and mobile) → Lighthouse CI
(mobile).

Every site check runs even after one fails, so a PR shows all its failures at
once. Reports upload as a build artifact for 14 days, never to public storage.

### Lighthouse standard

Deterministic lab signals fail the build. Throttled performance on a shared CI
runner moves several points between identical runs, so performance warns: a
gate that fails on runner noise is a gate that gets switched off. Playway's
measured baseline of 24 September 2026 (performance 89–96 across 37 pages)
would have failed a hard 0.90 floor on pages that are fine.

| Audit | Standard | Enforcement |
|---|---|---|
| Accessibility score | ≥ 0.95 | fail |
| Best Practices score | ≥ 0.90 | fail |
| Cumulative Layout Shift | ≤ 0.05 | fail |
| `document-title`, `meta-description`, `http-status-code`, `link-text`, `crawlable-anchors`, `hreflang`, `canonical` | pass | fail |
| Performance score | ≥ 0.90 | warn |
| Largest Contentful Paint | ≤ 4000 ms | warn |
| Total Blocking Time | ≤ 300 ms | warn |

The SEO category score is not asserted. Lighthouse fails `robots-txt` on the
Content-Signal directive (a deliberate `ai-train=no`) and `is-crawlable` on
deliberate noindex pages, so the category would fail correct sites. The SEO
audits that matter are asserted one by one instead.

Third-party code is blocked during measurement (PostHog, HubSpot, Clarity,
Google tags, Zaraz, Turnstile), so a vendor's release never moves a site's
score. `"lighthouseUrls": "all"` tests every page the build emits, one run each,
so a new page is gated the day it ships. A list of paths runs three times each
and takes the median.

### Accessibility and layout

axe runs WCAG 2.2 AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`)
and fails on any violation. Every listed page must also reflow at 320px without
horizontal scroll (WCAG 1.4.10). A wide table scrolling inside its own
`overflow-x` container passes; it does not widen the document.

### Guards

- **PostHog is server-side only.** `posthog-node` inside `src/lib/server`,
  `src/pages/api`, `src/actions` or `src/middleware`; EU host; the key is never
  `PUBLIC_` and never hard-coded; every event is tagged with `__DEPLOY_ENV__`.
- **Every tag goes through Cloudflare Zaraz, GTM included.** No tag loads
  directly: GTM, Google Analytics, Meta, Hotjar, LinkedIn, TikTok, Microsoft
  Clarity and HubSpot tracking code are blocked. HubSpot form embeds are
  forms, not tags, and are allowed.
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
  `wrangler` write command. If one is genuinely unavoidable, the workflow
  carries a comment `# ship-gate-allow-cloudflare: <reason>`, and every run
  prints that reason as a warning.
- **Lighthouse reports stay private.** Temporary public storage fails.
- **One dependency bot.** Dependabot and Renovate together warn: every update
  would arrive twice.

The contract check also refuses any `build` script or site check that writes to
production (`wrangler deploy`, `wrangler secret`, `--remote`, remote
migrations). CI builds every PR; a merge gate must be read-only.

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
| `lighthouseUrls` | same as `pages` | A list of paths, or `"all"` for every page the build emits |
| `lighthouseBlockedUrls` | `[]` | Extra URL patterns to block during Lighthouse, e.g. `"*/relay/*"` |
| `checks.preBuild` | `[]` | npm script names to run before the build, e.g. `"test"` |
| `checks.postBuild` | `[]` | npm script names to run against the built output |
| `checks.browser` | `[]` | npm script names needing Chromium; they use the site's own Playwright |
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
config rule and generated Lighthouse setting still fires on bad input and
passes on good input. Add a case there for every new rule.

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
- **[TO CONFIRM]** Pages that render on the server rather than at build time
  are not served by the `static` server. A site with such pages in `pages` sets
  `"server": "preview"`, which has not yet been proven with the Cloudflare
  adapter in CI.
- Portus Immigration and FullFrameGear have no brand review skill yet. Their PRs
  get a manual check against the brand guide.
