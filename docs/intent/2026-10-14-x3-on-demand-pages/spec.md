# Spec: test on-demand pages, and load PostHog lazily (from intent.md 2026-10-14)
Status: accepted (Paul, 14 October 2026: "Go recommended": concern 3 accepted as the cost of the budget).

## Requirements

**A. Serving the Worker (`"server": "preview"`)**
1. With `"server": "preview"`, `verify` serves the site with `npm run preview` (for `@astrojs/cloudflare`: workerd through
   `@cloudflare/vite-plugin`), and every served-URL check runs against it: Ship Gate's Playwright suite (`page.spec.ts`,
   the header checks in `edge.spec.ts`), Lighthouse, and the site's own browser checks (`run-checks.sh --serve`).
2. The served Worker uses local bindings only. In every serve step Ship Gate:
   - sets `CLOUDFLARE_VITE_FORCE_LOCAL=true`;
   - unsets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL`;
   - keeps `astro preview` in the foreground (Astro 7 backgrounds it when it detects an agent).
3. `prepare` fails, naming the binding, when `server` is `preview` and the site's wrangler config
   (`wrangler.jsonc`/`.json`/`.toml`) or the built `dist/server/wrangler.json` marks any binding `remote: true`.
4. The serve step waits up to 90 s for the first response (today 30 s); the first 200 took 12.5 s in a cloud session.
   On exit it stops the whole process group, not only the `bash -c` wrapper.
5. `pages` may list on-demand paths when `server` is `preview`. Each one is checked like any other page (smoke, axe,
   CSP, consent, keyboard, reflow, Lighthouse). An on-demand page may answer 200, or redirect to a path the site names
   in a new optional key, `onDemand.signInPath` (a gated page sends a visitor to sign in). A redirect is checked as a
   redirect (status 302/303/307, `Location` on the same origin), and its target page is checked as a page.
6. CSP is checked from the response header or the `<meta http-equiv>` tag, whichever the page carries (a prerendered
   page carries the tag; an on-demand page, the header). No page may carry neither.

**B. Discovery with on-demand pages**
7. `check-discovery.mjs` keeps reading the static build only, unchanged. On-demand prefixes stay in
   `discovery.ignoreLinks`, as the README says today.
8. A new served-site check (Playwright, beside `edge.spec.ts`, run only when `server` is `preview`) requests every
   internal link target found in the build that has no emitted file and is not under `/api/` or `/ph/`, and every
   on-demand entry in `pages`. Each must answer 200 or a same-origin redirect (R5). An on-demand page that answers 200
   must carry a canonical to itself and must not be in the sitemap unless indexable. Static sites never run it.

**C. PostHog loads lazily**
9. `templates/caller/posthog/src/components/PostHog.astro` keeps the key check and the init-once guard synchronous, and
   loads `posthog-js` with a dynamic `import()` after the `load` event, in `requestIdleCallback` with a 1 s timeout
   (`setTimeout` 1 s where unsupported). Init, the `loaded` callback, `register(tag)` and `window.posthog` are as today.
   After init it dispatches `posthog:ready` on `document`.
10. `posthog-js` is not in the first-screen JS: the page's entry script and modulepreload links don't contain it. The
    fixture asserts this from the built HTML.
11. The first `$pageview` is still captured, with the page's URL. Cookieless-until-consent (`on_reject`), the
    `environment` tag and the `/ph` proxy are unchanged.
12. `PostHogZarazConsent.astro` also runs `sync()` on `posthog:ready`, so consent given before PostHog loads is applied.
13. `e2e/page.spec.ts` waits for `window.posthog.__loaded` (up to 10 s) instead of a fixed 1.5 s.

**D. Release**
14. Ship Gate minor release (v3.14.0): README (server modes, the on-demand section, the Open items line removed,
    PostHog loading), CHANGELOG, version pins. A static site that passed v3.13.1 passes v3.14.0 with no change.

## Design
- **Serve (A):** `prepare.mjs` builds `serveCommand` for preview as
  `env -u CLOUDFLARE_API_TOKEN … CLOUDFLARE_VITE_FORCE_LOCAL=true <foreground switch> npm run preview -- --port $PORT`,
  exported once as `SHIP_GATE_SERVE` and reused by `run-checks.sh`, lhci's `startServerCommand` and Playwright's
  `webServer`, so the three can't drift. The foreground switch's exact name is confirmed from Astro's source in the
  plan. `run-checks.sh` starts it with `setsid` and kills the group. The remote-binding guard reads the config as JSONC
  or TOML with the parsers `prepare.mjs` already has, falling back to a text match on `remote` for TOML.
- **Proof (A):** a second fixture, `test/fixture-worker`: Astro with `@astrojs/cloudflare`, a `src/worker.ts` that
  sets headers, one `prerender = false` page, one gated page that redirects to `/signin/`, and one API route. A new
  `fixture (worker)` job in `self-test.yml` runs `verify` on it with `server: preview`, plus broken variants
  (a `remote: true` binding fails `prepare`; an on-demand page with no CSP fails R6). It is the proof the README's
  open item asks for.
- **Discovery (B):** the scan stays file-based, so static sites see nothing new. Astro's route manifest
  (`dist/server/entry.mjs`) is internal and changes between versions, so Ship Gate does not read it; the served check
  derives targets from links in the build instead.
- **PostHog (C):** Vite splits the dynamic import into its own chunk; Astro adds no modulepreload for it, so the first
  screen carries only the small entry script. The key stays in the entry script, so `check-posthog.mjs` and
  `check-posthog-live.mjs` still find it (their header comments say so). The chunk is served from `/_astro/`, so no
  CSP change. The snippet (`PostHogSnippet.astro`) is unchanged; it is not an option here because it needs
  `'unsafe-inline'`, which conflicts with hash-based CSP.
- **Security:** no secret is read or printed; secrets set in the CI environment reach the local Worker only through
  the site's own `.dev.vars`/process env, as in `npm run dev`. Nothing writes to Cloudflare.

## Areas of concern
1. **Secrets in the runner's environment reach the preview Worker** (the plugin logs "Using secrets defined in
   process.env"). Ship Gate's `verify` sets none, and R2 unsets the Cloudflare credentials. Owner: Ship Gate; resolved
   by R2 and a README line that a site must not put production secrets into `verify`'s environment.
2. **Lighthouse readiness with preview** has never run. Owner: Ship Gate; the fixture job proves it, and the plan says
   what to do if lhci's ready pattern doesn't match.
3. **Visitors who leave within ~1 s of load send no pageview** after the lazy load. Owner: Paul (product). Resolved:
   accepted as the cost of the budget (14 October 2026); no pre-load beacon.
4. **`verify` time.** A second fixture job adds Ship Gate CI minutes (its own repo only). For a site, preview's
   start-up adds ~15 s per serve step. Within the 30-minute timeout.

## Out of scope
- Sites that deploy something other than `@astrojs/cloudflare` with `server: preview`.
- Crawling the served site beyond the targets in R8; a sitemap of on-demand pages.
- web-baseline 6.6.0 itself (pauljosephdp/Skills): it pins v3.14.0, copies the new `PostHog.astro` and
  `PostHogZarazConsent.astro`, approves `@supabase/supabase-js`, `@supabase/ssr` and `@supabase/realtime-js`, and makes
  `critical-gate` match `supabase/migrations/**`. Its own PR, after this release.
- Target Price changing to `server: preview` (its S1–S4 Part B).
