# Portfolio CI audit, 24 September 2026

On 24 September 2026 I read every repo under `pauljosephdp` to answer two
questions: what each site checks today, and what adopting Ship Gate v1.1.0
asks of it. Ship Gate's standard was set from this audit.

The rule for moving checks:
- A check any Astro-on-Cloudflare site would want becomes Ship Gate code.
- A check about one brand or one site's content stays in that site's repo and
  runs through `checks`.
- Nothing that writes to production runs in the gate.

The five portfolio sites with code (Playway, Qualified Deals, Frame to Funnel,
Cocoon, LowLightKing) were read in full on `main`: workflows, `package.json`
scripts and every script those call. Anything still unverified is marked
**[TO CONFIRM]**.

## Summary

| Site | CI today | Moves into Ship Gate | Blocking at adoption |
|---|---|---|---|
| Playway (`site/`) | 7 gates in `build.yml` (`gates`, `lighthouse`) | astro check, generic half of the structure scan, Lighthouse | none; its `lighthouserc.cjs` becomes the standard |
| Qualified Deals | `ci.yml` (`verify`, `accessibility`) | astro check, missing/duplicate/length metadata, axe WCAG 2.2 AA, 320px and 200% reflow | `posthog-js`; axe moves from production to the PR build |
| Frame to Funnel | Lighthouse only (daily cron in practice) | Lighthouse, build, tests | auto-merge to `main`; episode sync pushes to `main`; Cloudflare tokens; public Lighthouse storage; `posthog-js`; inline GTM |
| Cocoon | none (gates run inside Workers Builds `ci:build`) | astro check, the generic halves of `verify:build` | `ci:build` ends in a remote D1 migration; no Node pin; `posthog-js`; inline GTM; HubSpot embed |
| LowLightKing | none (20 local scripts) | astro check, CSP, redirects, overflow, placeholder copy, generic `verify-deploy` checks, Lighthouse | `posthog-js`; HubSpot embed; hard-coded Chromium path |
| FullFrameGear, Gallivant, Portus | README only | — | none; adopt in the first PR |

Every site builds with Astro 7.3.3 and `output: 'static'`, so Ship Gate's
static server can serve them. Deploys are Cloudflare Workers Builds on push to
`main` for all five.

## Where each existing check goes

### Into Ship Gate (generic)

| Check | From |
|---|---|
| `astro check` | Playway `verify:types`, Qualified Deals `check`; local-only in Cocoon and LowLightKing; Frame to Funnel has no `check` script (add one) |
| Unit tests (`npm test`) | Playway, Qualified Deals; local-only in Frame to Funnel |
| One `h1`, heading order, `noopener`, title/description present, unique and within bands, canonical, `_headers`/`_redirects` validity and conflict markers, `{{token}}` leaks, `llms.txt` links | Playway `structure-scan.mjs`, Qualified Deals `check-meta.mjs`, Cocoon `verify:build` |
| Placeholder copy | LowLightKing `check-copy.mjs` |
| axe WCAG 2.2 AA with motion settled | Qualified Deals `a11y-check.mjs` (was against production) |
| Reflow at 320/360/390px and 200% zoom | Qualified Deals `check-narrow.mjs`, LowLightKing `check-overflow.mjs` |
| CSP measured in the browser | LowLightKing `check-csp.mjs` |
| `_redirects` statuses, Locations, destinations | LowLightKing `check-redirects.mjs` |
| Security headers, immutable assets, 404 page, `.assetsignore` | LowLightKing `verify-deploy.mjs` (generic half) |
| Lighthouse, all pages, third parties blocked | Playway `lighthouserc.cjs` (thresholds), Frame to Funnel `lighthouserc.cjs` (noindex skip) |

### Stays in the site repo, run through `checks`

| Site | preBuild | postBuild | browser (served build) |
|---|---|---|---|
| Playway | `verify:fonts`, `verify:contrast`, `verify:drift` (name the direct commands) | site-only structure rules (`®`, one `btn--primary`, `/go/` in robots) split out of `structure-scan.mjs` | `verify:motion` |
| Qualified Deals | `lastmod:check` (needs `fetch-depth: 0`) | `check-meta` (keyword and overlap warnings; set `structure` to 45–60 / 140–160) | — |
| Cocoon | `check:schemas`, `check:canon` | `check:prices`, `verify:build` (consent mode, analytics singleton) | — |
| LowLightKing | `check:tokens`, `voice-lint`, `check:images`, `check:content` | — | `check:motion`, `check:nav` |
| Frame to Funnel | `format:check` | — | — |

Playway needs `"python": { "version": "3.11", "packages": ["fonttools==…", "brotli==…"] }`,
and LowLightKing needs Python 3 for `check:tokens` and `voice-lint`.

### Moves to post-deploy or a schedule

- Qualified Deals `a11y-check` against production: into `post-deploy.yml`.
- Cocoon `verify:deploy`, `seo:diff`, `data:freshness --ci`.
- LowLightKing `check:indexing`, `psi`, `verify:deploy <production URL>`.
- IndexNow in every site: scheduled, never in the gate.

### Never in any gate

- Cocoon `ci:build`, `deploy` and `migrate:remote` (a remote D1 write).
- Frame to Funnel's `wrangler.toml` `[build]` command, which runs a remote D1
  migration whenever wrangler builds. This is why Ship Gate never starts
  `wrangler dev`.
- `set-worker-secrets.yml` and `sync-guide-to-r2.yml`.
- LowLightKing `sync:r2`.
- Paid API scripts: Cocoon `data:airroi`, `generate-hero-art`; LowLightKing
  `generate-images`.

The contract check refuses any of these as a `build`, `check` or `lint`
script, or in `checks`.

## Per site

### Playway (`site/`)

- **Setup:** `working-directory: site` in both workflows, and Dependabot npm
  `directory: /site`. Node comes from `site/.node-version` (22.22.2).
- **Delete:** `build.yml` and `site/lighthouserc.cjs`. The standard is
  Playway's own 24 September baseline:
  - accessibility 1.0
  - CLS ≤ 0.05
  - performance, LCP and TBT warn
  - the same six SEO audits

  Carry `best-practices` 1.0 over as a stricter override, and set
  `"lighthouseBlockedUrls": ["*/relay/*"]` and `"lighthouseUrls": "all"`.
- **Structure scan:** keep only the site-specific rules in `structure-scan.mjs`
  and run them as a postBuild check. The generic rules now run in Ship Gate.
- `verify:motion` uses port 4322 and its own server. Switch it to read
  `SHIP_GATE_BASE_URL`.

### Qualified Deals

- **Contract changes:**
  - Add `fetch-depth: 0` to checkout.
  - Add a `lastmod:check` script.
  - Set `"structure": { "titleMin": 45, "titleMax": 60, "descMin": 140, "descMax": 160 }`.
- **Replace** `ci.yml`'s two jobs with `verify`. Ship Gate now runs
  `check-narrow` and axe on the PR build.
- **Post-deploy:** move `a11y-check` (production) to `post-deploy.yml`.
- **Exemption:** adopt `posthog-js` under a dated `posthog-client` exemption,
  then move events to `posthog-node`.
- **Dependency bot:** keep Renovate or switch to Dependabot, not both.

### Frame to Funnel

**Process changes before adoption:**
- Delete `auto-merge-to-main.yml` and open PRs instead; use GitHub's
  "auto-merge when checks pass" if you want hands-off merging.
- `episode-sync.yml` must open a PR instead of pushing to `main`.

A push to `main` is never exemptible, and the `main` ruleset will reject such
pushes.

**Cloudflare tokens:** `set-worker-secrets.yml` (Workers Scripts: Edit) and
`sync-guide-to-r2.yml` (R2 Edit) either leave Actions or run under a dated
`cloudflare-in-workflows` exemption.

**Delete `lighthouse.yml`:** it uses public storage, and Ship Gate replaces it.
Keep its stricter performance gate with
`{ "audit": "categories:performance", "level": "error" }` if wanted. Note that
this fails on runner noise; see the README.

**Other changes:**
- Add a `check` script (`astro check`).
- Pin Node in `.nvmrc`; today it is only `engines` plus 24 in CI.
- Adopt `posthog-js` and inline GTM `GTM-WX55ZRKV` under dated exemptions.
- `markdown-endpoints.test.ts` needs `dist/`. Before the build it skips itself,
  so run it again as a postBuild check if it matters.

### Cocoon

- **Workers Builds:** change the build command from `npm run ci:build` to
  `npm run build`. Run `migrate:remote` by hand when a migration lands. This is
  a dashboard change for Paul.
- **Node:** pin it at 22.18.0 or later. The check scripts import `.ts` files
  directly, which needs Node's type stripping.
- **Exemptions:** adopt `posthog-js`, inline GTM `GTM-M7WZHXT7` and the HubSpot
  form embed under dated exemptions.

### LowLightKing

- **Chromium path:** `check-csp.mjs` and `check-overflow.mjs` hardcode
  `/opt/pw-browsers/chromium-1194`. Both are superseded by Ship Gate.
  `check-motion` and `check-nav` must read `BASE_URL`. They already accept
  `CHROME_PATH`.
- **`verify-deploy.mjs`:** keep only the site-specific half (Markdown twins,
  HubSpot frame attributes).
- **Exemptions:** adopt `posthog-js` and the HubSpot embed under dated
  exemptions.
- **CSP:** the policy is Report-Only. Ship Gate still fails on any violation, so
  switching to enforcing stays safe.

### FullFrameGear, Gallivant, Portus

These are README only. Adopt Ship Gate in the first code PR, so every later
change is gated.

## Outside Ship Gate's scope

- `Skills` has its own `validate.yml`.
- `Brand-OS` is a design-system repo.
- `MinuJoseph` and `PaulJoseph` are README only.
- `Kochi`, `MalayalamFilmmakers`, `Puthenpurackal` and `Domains` are static
  HTML with no Astro build.
