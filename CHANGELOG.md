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
  adapter.
- `checks.preBuild`, `checks.postBuild` and `checks.browser` run a site's own
  npm scripts; all run, then all failures are reported. Optional `python` for
  Python checks.

**Lighthouse standard**
- Fail: accessibility ≥ 0.95, best practices ≥ 0.90 (was warn), CLS ≤ 0.05, and
  seven SEO audits individually.
- Warn: performance ≥ 0.90 (was fail), LCP ≤ 4000 ms, TBT ≤ 300 ms.
- The SEO category score is no longer asserted; Lighthouse fails it on correct
  robots.txt and noindex pages.
- `"lighthouseUrls": "all"` gates every emitted page. Third-party code is
  blocked during measurement.
- Overrides may raise any standard freely; loosening still needs a reason and
  an expiry date. v1's `category` form is still accepted.

**Accessibility**: axe now runs WCAG 2.2 AA, and every listed page must reflow at
320px without horizontal scroll.

**New guards**
- Node at or above 22.12.0, Astro 7's floor.
- No workflow pushes to `main`. No exemption.
- No Cloudflare API token or `wrangler` write command in a workflow, unless it
  carries a written `ship-gate-allow-cloudflare` reason, printed on every run.
- No public Lighthouse report storage.
- Microsoft Clarity and HubSpot tracking code must go through Zaraz.
- Warning when Dependabot and Renovate are both configured.
- The contract check refuses any `build` script or site check that writes to
  production.

**Self-test**: 62 cases (was 24), covering every new rule, the generated
Lighthouse config, and the static server's routing and path containment.

## v1.0.0 — 2026-09-24 (not released)

Initial commit of the central gate, replacing the per-repo `ship-gate-kit/`
copies. Superseded by v1.1.0 before any site adopted it.
