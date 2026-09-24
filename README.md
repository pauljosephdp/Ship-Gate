# Ship Gate

The single source for the merge gate on every Gallivant Ventures portfolio site:
LowLightKing, Frame to Funnel, Playway Books, Cocoon, Qualified Deals, Portus
Immigration and FullFrameGear.

Site repos do not copy these files. They call this repo, pinned to a version.
A rule or threshold changes here once, and reaches each site through that
site's own reviewed Dependabot PR.

## What lives where

**Here, identical for every site:** stack guards, contract checks, the
client-bundle PostHog scan, the Playwright + axe smoke test, Lighthouse
thresholds, and the post-deploy check.

**In each site repo, small and site-specific:**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Calls `pauljosephdp/Ship-Gate@vX.Y.Z` in a job named `verify` |
| `.github/workflows/post-deploy.yml` | Calls `pauljosephdp/Ship-Gate/post-deploy@vX.Y.Z` |
| `ship-gate.config.json` | Site URL, pages to test, form pages, any threshold override |
| `.github/dependabot.yml` | Bumps npm packages and the pinned Ship Gate version |
| `.github/pull_request_template.md` | The review checklist |

Templates for all five are in `templates/caller/`.

## The gate

`verify` runs, in order: stack guards → contract check → `npm ci` →
`astro check` → lint → build → client-bundle PostHog scan → Playwright + axe
(desktop and mobile) → Lighthouse CI (mobile, median of 3 runs).

| Check | Minimum | Enforcement |
|---|---|---|
| Lighthouse Performance | 0.90 | fail |
| Lighthouse Accessibility | 0.95 | fail |
| Lighthouse SEO | 0.95 | fail |
| Lighthouse Best Practices | 0.90 | warn |
| axe | zero WCAG 2.1 A/AA violations | fail |

The guards enforce the portfolio standard:

- PostHog is server-side only: `posthog-node` inside `src/lib/server`,
  `src/pages/api`, `src/actions` or `src/middleware`; EU host; key never
  `PUBLIC_`; never hard-coded; every event tagged with `__DEPLOY_ENV__`.
- Every tag, GTM included, runs through Cloudflare Zaraz. No tag loads directly,
  and there is no server-side GTM in this stack.
- Every `<form>` has Turnstile. A non-public form opts out with
  `<!-- turnstile-exempt: reason -->`.
- No committed `.env` or `.dev.vars` files.
- Workers config, not Pages config.
- Node pinned in `.nvmrc`.

Cloudflare Workers Builds is the only deployer. Nothing here deploys, and no
site workflow may run `wrangler deploy`.

## One-time setup of this repo

1. **Allow the site repos to use it.** Settings → Actions → General → Access →
   *Accessible from repositories owned by the user 'pauljosephdp'*. Without
   this, every site's `verify` fails to download the action.
2. **Protect `main`.** Settings → Rules → Rulesets: require a pull request,
   require the `self-test` check, block force pushes and deletions.
3. **Publish v1.0.0.** Releases → Draft a new release → tag `v1.0.0` on `main`.
   Site templates pin this tag.

## Adopting it in a site repo

1. Copy `templates/caller/` into the site repo root. Rename
   `gitignore-additions.txt` into the site's `.gitignore`.
2. Delete the old kit copies if present: `scripts/guards.sh`,
   `scripts/check-dist.sh`, `lighthouserc.cjs`, `tests/e2e/smoke.spec.ts`.
   The contract check fails while the first three exist.
3. Fill in `ship-gate.config.json`: one page per key template (home,
   service or product, contact, article), and every page with a public form.
4. Install the required dev dependencies:
   `npm i -D @astrojs/check typescript eslint prettier @playwright/test @axe-core/playwright @lhci/cli`
5. Keep the standard `package.json` script names: `check`, `lint`, `build`,
   `preview`.
6. Pin Node in `.nvmrc` and set the same `NODE_VERSION` build variable in
   Workers Builds.
7. Add the two build-time markers to `astro.config.mjs`:
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
8. In the site's PostHog project, add *`environment` is not `production`* to
   the internal and test account filter, applied by default.
9. Ruleset on the site's `main`: require a pull request, require the `verify`
   check, require the branch to be up to date, block force pushes and
   deletions. Required approvals: 0 while Paul is the only committer.
10. Workers Builds: production branch `main`, non-production branch builds on,
    preview URLs on.
11. Turn on secret scanning, push protection and Dependabot alerts.

Claude Code prompt for steps 1–8:

> Adopt Ship Gate in this repo following pauljosephdp/Ship-Gate README
> "Adopting it in a site repo", steps 1–8. Delete the old kit copies rather
> than running them. Run `npm run check` and `npm run build` locally, fix or list
> every failure, and open a PR titled "chore: adopt ship gate v1.0.0". Do not
> change deploy configuration or Cloudflare settings.

## Per-site threshold overrides

A site may lower a Lighthouse threshold only in its own
`ship-gate.config.json`, with a reason and a restore date:

```json
"thresholdOverrides": [
  { "category": "performance", "minScore": 0.85,
    "reason": "Hero video pending re-encode", "restoreBy": "2026-12-31" }
]
```

The gate rejects an override with no reason, one that doesn't actually lower
the standard, and one past its restore date. An expired override fails the
build until the threshold is restored or the override is renewed.

## Changing Ship Gate

Every change goes through a PR to this repo, and `self-test` must pass.
`scripts/self-test.sh` builds fixture sites at run time and proves each guard
and config rule still fires on bad input and passes on good input. Add a case
there for every new rule.

Then publish a release. Version by effect on site repos:

- **Major** (v2.0.0): a site must change something to stay green. A new failing
  guard, a new required script or dependency, a raised threshold.
- **Minor** (v1.1.0): new warnings, new optional config, new checks that a
  conforming site already passes.
- **Patch** (v1.0.1): fixes that make no conforming site fail.

Dependabot then opens a PR in each site repo, and that PR runs through the
site's own `verify` before merging. A bad release fails on one PR instead of
breaking seven sites at once.

## Open items

- **[TO CONFIRM]** Dependabot can open Ship Gate bump PRs from a private repo
  in a personal account. If it can't, bump the pinned version by hand in each
  site's two workflow files.
- **[TO CONFIRM]** The Node major that Astro 7.3.3 requires, for each `.nvmrc`.
- **[TO CONFIRM]** `astro preview` serves correctly in CI with the Cloudflare
  adapter. If not, the gate needs a `wrangler dev` mode.
- **[TO CONFIRM]** `WORKERS_CI_COMMIT_SHA` and `WORKERS_CI_BRANCH` are present
  in production builds, so the post-deploy SHA check and environment tagging
  both work.
- Portus Immigration and FullFrameGear have no brand review skill yet. Their PRs
  get a manual check against the brand guide.
