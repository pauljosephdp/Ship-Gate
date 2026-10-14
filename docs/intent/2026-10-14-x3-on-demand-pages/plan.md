# Plan: test on-demand pages, and load PostHog lazily (from spec.md 2026-10-14)
Status: draft.

## Files that change

**Serve the Worker (R1–R6)**
- `scripts/prepare.mjs` — the preview `serveCommand` (R2): `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY
  -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_EMAIL CLOUDFLARE_VITE_FORCE_LOCAL=true ASTRO_PREVIEW_BACKGROUND=1 npm run
  preview -- --port $PORT`. `ASTRO_PREVIEW_BACKGROUND` is the switch Astro 7 reads to skip agent auto-backgrounding
  (`astro/dist/cli/preview/index.js:45`); other versions ignore it. The remote-binding guard (R3) over
  `wrangler.jsonc`/`.json`/`.toml` and `dist/server/wrangler.json`. The optional `onDemand.signInPath` key (R5),
  validated like the other path keys. The after-build `pages` check accepts on-demand paths when `server` is `preview`.
- `scripts/run-checks.sh` — start the server with `setsid`, wait up to 90 s, kill the process group on exit (R4).
- `e2e/helpers.ts` (or the spec that reads CSP) — CSP from the header or the `<meta http-equiv>` tag (R6).
- `e2e/page.spec.ts` (**protected**) — a redirect to `onDemand.signInPath` passes as a redirect, and its target is
  checked (R5); the PostHog check waits for `window.posthog.__loaded` up to 10 s instead of 1.5 s (R13).
- `e2e/on-demand.spec.ts` (new) — the served-site check of R8; it skips unless `server` is `preview`.
- `playwright.config.ts` / the Lighthouse config `prepare.mjs` writes — use `SHIP_GATE_SERVE` and a 90 s start timeout.

**The proof fixture**
- `test/fixture-worker/` (new) — Astro 7.3.5 + `@astrojs/cloudflare` 14.3.3 (exact pins, own `package-lock.json`):
  `src/worker.ts` setting the security headers and a CSP header, `/` prerendered, `/account/` (`prerender = false`)
  rendering the time of the request, `/private/` redirecting 303 to `/signin/`, `/signin/` on demand,
  `/api/ping/` JSON; `ship-gate.config.json` with `"server": "preview"`, `onDemand.signInPath: "/signin/"`, and
  `pages` listing the on-demand pages. No bindings.
- `test/break-fixture.sh` (**protected**) — takes the fixture from `SHIP_GATE_FIXTURE` (default `fixture-site`), and
  adds two variants on `fixture-worker`: `remote-binding` (a KV binding with `remote: true`) and `on-demand-no-csp`
  (the Worker drops its CSP header on `/account/`).
- `test/expect-gate.sh` (**protected**) — expectations: `worker-conforming` passes the full gate; `remote-binding`
  fails at prepare naming the binding; `on-demand-no-csp` fails in the browser stage. For `analytics-always-on` it
  also asserts that no `<script src>` or `modulepreload` in the built `index.html` contains posthog-js (R10).
- `.github/workflows/self-test.yml` — a third matrix group, `worker`, with a `dir` field so its steps use
  `working-directory: test/fixture-worker` (the others keep `test/fixture-site`); `touches_fixtures` already covers
  `test/`.
- `scripts/self-test.sh` — the "every fixture gate step passes its stage" count matches both fixture directories; new
  unit cases for the remote-binding guard (JSONC and TOML, true and false) and the preview serve command.

**PostHog (R9–R13)**
- `templates/caller/posthog/src/components/PostHog.astro` — lazy load as in spec R9; dispatches `posthog:ready`.
- `templates/caller/posthog/optional/src/components/PostHogZarazConsent.astro` — `sync()` on `posthog:ready` (R12).
- `scripts/check-posthog.mjs` — header comment only: the key is in the entry script, the SDK in a dynamic chunk.

**Docs and release (R14)**
- `README.md` — `server` modes (preview proven with the Cloudflare adapter, the env Ship Gate sets, the remote-binding
  rule, no production secrets in `verify`'s environment), `onDemand.signInPath`, the on-demand check, lazy PostHog;
  the Open items line on preview removed; version pins to v3.14.0.
- `CHANGELOG.md` — `## v3.14.0`.
- This plan, when the work departs from it.

## Order of work
1. **PostHog first** (small, independent): template, consent bridge, `page.spec.ts` wait, `expect-gate.sh` R10
   assertion. Build the fixture with `analytics-always-on` and run the browser suite: passes; posthog-js absent from
   the entry script. Then check R10 fails against the old template (the assertion is real).
2. **Serve command and guard**: `prepare.mjs` (serve command, guard, `onDemand` key), `run-checks.sh`, Playwright and
   Lighthouse start-up. Self-test unit cases first (red), then the code (green).
3. **Fixture worker**: create it, `npm install` to pin the lock, build, then run `prepare` + the browser suite +
   Lighthouse against it in preview mode in this session. Fix what it finds (CSP from header, redirect handling).
4. **On-demand check** (`e2e/on-demand.spec.ts`) and the two broken variants; each fails on its own check.
5. **Static regression**: the existing `conforming` and every variant of both groups behave exactly as before.
6. **CI**: the `worker` matrix group; self-test's stage count.
7. **Docs**: README, CHANGELOG v3.14.0, pins; `check-readme.sh`.
8. Checks, verifier, reviewer (`TALLY: important=0`); a second, adversarial review (this changes the action);
   then the draft PR, ready once final.

## Risks
1. **Riskiest step: Lighthouse with preview.** lhci's `startServerCommand` waits for a ready pattern; preview prints
   different start-up text. If it doesn't match, set `startServerReadyPattern` from what the fixture prints, or start
   the server once in `run-checks.sh`-style and point lhci at the URL with no start command.
2. **A static site changes behaviour.** Every new path is behind `server === 'preview'`; the static fixture's ten
   variants per group prove it (step 5).
3. **The lazy load loses the PostHog e2e assertions in CI** (slow runner). The 10 s wait covers a 1 s idle timeout
   with margin; if it is still short, raise the wait, never drop the assertion.
4. **The fixture worker pulls a large dependency tree** (`@astrojs/cloudflare`, workerd): about a minute more per
   `worker` job; cached by the existing npm cache.
5. **`ASTRO_PREVIEW_BACKGROUND` is an Astro internal.** If a later Astro drops it, preview would background only under
   an agent, never on a GitHub runner; the fixture job catches a change on Astro bumps.

Options not taken: reading Astro's route manifest (internal, fragile); the PostHog snippet (needs `'unsafe-inline'`);
the slim posthog-js build (as large once its extensions are registered); a pre-load pageview beacon (declined, spec
concern 3).

## Proof
- `bash scripts/self-test.sh` → "Self-test: N passed, 0 failed." (N grows by the new cases).
- `shellcheck -S error scripts/*.sh test/*.sh .claude/hooks/*.sh` → no output.
- `bash scripts/check-readme.sh origin/main` → "README.md is up to date."
- Browser suite on the fixtures (verifier step 4): `conforming` passes; each touched static variant fails on its own
  check; `worker-conforming` passes the full gate in preview mode, Lighthouse included; `remote-binding` and
  `on-demand-no-csp` fail on theirs; `analytics-always-on` passes with posthog-js out of the entry script.
- `bash evals/run.sh` only if `CLAUDE.md`, `REVIEW.md` or `.claude/` change (not planned).
- On the ready PR: `self-test`, `fixture (browser)`, `fixture (scans)` and `fixture (worker)` green.
- After merge: tag `v3.14.0` and its release exist at the merge commit.
