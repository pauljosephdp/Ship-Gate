# Changelog

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
