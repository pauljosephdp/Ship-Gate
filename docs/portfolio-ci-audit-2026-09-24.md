# Portfolio CI audit — 24 September 2026

A read of every repo under `pauljosephdp` on 24 September 2026: what each site
checks today, and what adopting Ship Gate v1.1.0 asks of it. Ship Gate's
standard was set from this audit. It keeps what the sites already enforce,
fixes what they contradict, and moves each site's own checks into `checks`
rather than dropping them.

Findings are from the files on `main` on that date. Anything not read directly
is marked **[TO CONFIRM]**.

## Summary

| Site | CI today | Blocking gaps for Ship Gate |
|---|---|---|
| Playway | Strong: 7 gates across 2 jobs | Own `lighthouserc.cjs` to fold into overrides; checks need npm script names |
| Qualified Deals | Good: types, tests, build, metadata, WCAG 2.2 AA, reflow | `posthog-js`; Renovate and Dependabot overlap |
| Frame to Funnel | Lighthouse only, daily | Auto-merge to `main`; Cloudflare token in GitHub; public Lighthouse reports |
| Cocoon | None | `posthog-js`; no Node pin; `ci:build` runs remote migrations |
| LowLightKing | None, but 20 local check scripts | `posthog-js` |
| FullFrameGear, Gallivant, Portus | README only | Greenfield: scaffold per the migration playbook, Mode B |

## Playway (`site/`)

**Today** (`.github/workflows/build.yml`): unit tests; build with a
document-structure scan; `astro check` via `verify:types`; a motion gate in
Chromium; contrast recomputed in Python; self-hosted font coverage; Playground
Primary drift scan; Lighthouse over all 37 pages as a separate job. Node from
`site/.node-version`. Reports upload to the filesystem, deliberately not public.

**Adopting:**

- `working-directory: site` in both workflows; Dependabot npm `directory: /site`.
- `"lighthouseUrls": "all"` and `"lighthouseBlockedUrls": ["*/relay/*"]`.
- Carry the stricter baseline over:
  ```json
  "thresholdOverrides": [
    { "audit": "categories:accessibility", "minScore": 1 },
    { "audit": "categories:best-practices", "minScore": 1 }
  ]
  ```
  Then delete `site/lighthouserc.cjs`. CLS ≤ 0.05 and the individual SEO audits
  match the standard already.
- Give the direct commands npm script names, then list them:
  ```json
  "checks": {
    "preBuild": ["test", "verify:fonts", "verify:contrast", "verify:drift"],
    "browser": ["verify:motion"]
  },
  "python": { "version": "3.11", "packages": ["fonttools", "brotli"] }
  ```
  `verify:contrast` runs `python ../design-system/verify-contrast.py`, which
  still resolves from `site/`.
- **[TO CONFIRM]** whether `verify:types` is the same as `check`. If it is, drop
  it; Ship Gate runs `check` already.
- **[TO CONFIRM]** how HubSpot and Clarity load. Playway's Lighthouse config
  blocks both. If either tracking script loads directly rather than through
  Zaraz, the tag guard fails it. HubSpot form embeds are allowed.

## Qualified Deals

**Today** (`.github/workflows/ci.yml`): `astro check`; sitemap `lastmod`
freshness (needs full git history); vitest; build with no secrets; metadata
bands. A second job runs axe at WCAG 2.2 AA against production and a 320px /
200% zoom reflow check on a local build. `indexnow.yml` runs daily and holds no
secrets. Node 22.12.0 in `.nvmrc`.

**Adopting:**

- `fetch-depth: 0` in `ci.yml` (the template shows where).
- Add `"lastmod:check": "node scripts/gen-lastmod.mjs --check"` to
  `package.json`, then:
  ```json
  "checks": {
    "preBuild": ["test", "lastmod:check"],
    "postBuild": ["check-meta"],
    "browser": ["check-narrow"]
  }
  ```
- `a11y-check` scans production, so a PR cannot fix what it reports. Ship
  Gate's axe now runs WCAG 2.2 AA on the PR's own build. Keep `a11y-check` as a
  scheduled job if you still want the production view, not as a merge check.
- Remove `posthog-js` and move events to `posthog-node` server-side.
- Keep one dependency bot. Ship Gate's templates use Dependabot, which also
  bumps the pinned Ship Gate version; Renovate can do the same if preferred.
- `indexnow.yml` stays as it is.

## Frame to Funnel

**Today:** `lighthouse.yml` gates Home and `/audit` (performance and best
practices ≥ 0.90, accessibility and SEO ≥ 0.95, all failing) on a daily
schedule, because pushes to `main` from `GITHUB_TOKEN` never trigger it. Node 24.

**Blocking, and needs a decision before adoption:**

- **`auto-merge-to-main.yml` merges every branch into `main` and deploys it,
  with no gate.** The `episode-sync.yml` workflow also pushes straight to `main`,
  per auto-merge's own comments (**[TO CONFIRM]** by reading it). Both fail
  the push-to-`main` guard, and a `main` ruleset will reject their pushes. The
  replacement: each workflow opens a PR, and auto-merge is GitHub's own
  "auto-merge when checks pass" setting on that PR.
- **`set-worker-secrets.yml` holds a Cloudflare API token** with Workers
  Scripts: Edit. Set Worker secrets once with `wrangler secret put` from your
  own machine, or in the dashboard, then delete the workflow and the GitHub
  secret, and rotate the token.
- **`sync-guide-to-r2.yml`** uses an R2 token, per `set-worker-secrets.yml`'s
  comments (**[TO CONFIRM]** by reading it). Either move the upload into the
  build, or keep it with `# ship-gate-allow-cloudflare: <reason>`.
- `lighthouse.yml` publishes reports to public storage. Deleting it on adoption
  resolves this; Ship Gate's Lighthouse replaces it.

**Adopting:** keep its stricter performance gate with
`{ "audit": "categories:performance", "level": "error" }`. `indexnow.yml`
stays. **[TO CONFIRM]** its `package.json` scripts and PostHog setup, which
were not read in this audit.

## Cocoon

**Today:** no CI. Local scripts: `check`, `check:schemas`, `check:prices`,
`check:canon`, `verify:build`. `ci:build` chains these with
`migrate:remote`, which applies D1 migrations to production.

**Adopting:**

- ```json
  "checks": { "postBuild": ["check:schemas", "check:prices", "check:canon", "verify:build"] }
  ```
  Never list `ci:build`, `deploy` or `migrate:remote`; the contract check
  refuses them.
- Pin Node 22.12.0 or later in `.nvmrc`; there is none today.
- Remove `posthog-js`; it has `posthog-node` already.
- **[TO CONFIRM]** whether `data:freshness` and `seo:diff` belong in the gate.
  Both read external data, which makes them flaky as merge checks.

## LowLightKing

**Today:** no CI. Node in `.node-version`. Twenty local check scripts.

**Adopting:**

- Likely gate checks, each **[TO CONFIRM]** as needing no network or
  production access:
  ```json
  "checks": {
    "preBuild": ["check:tokens", "voice-lint", "check:content", "check:copy", "check:images"],
    "postBuild": ["check:csp", "check:redirects", "check:nav"],
    "browser": ["check:overflow", "check:motion"]
  }
  ```
- Keep out of the gate: `check:skill` (needs a local skills checkout),
  `verify:deploy` and `psi` (production), `check:parity` (compares against a
  saved snapshot), `check:indexing` (**[TO CONFIRM]**).
- Its `check:csp` is the only CSP check in the portfolio. Worth promoting into
  Ship Gate once its rules are read.
- Remove `posthog-js` and move events server-side.

## FullFrameGear, Gallivant, Portus

README only. Scaffold each from the migration playbook in Mode B, with Ship
Gate adopted in the first PR so every later change is gated.

## Outside Ship Gate's scope

`Skills` has its own `validate.yml` (skill validation and stale-manifest
check). `Brand-OS` is a design system repo. `MinuJoseph` and `PaulJoseph` are
README only. `Kochi`, `MalayalamFilmmakers`, `Puthenpurackal` and `Domains` are
static HTML sites with no CI and no Astro build. They could adopt a static-only
variant later.
