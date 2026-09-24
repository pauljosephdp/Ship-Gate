# Changelog

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

**Self-test**: 185 cases (was 115). The fixture site is discovery-ready, and
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
- Microsoft Clarity, HubSpot tracking and HubSpot form embeds, and inline GTM
  container ids, must go through Zaraz.
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
