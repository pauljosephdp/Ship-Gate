# Changelog

## v1.0.0 — 2026-09-24

First release. Replaces the per-repo `ship-gate-kit/` copies.

- Composite actions: `verify` (repo root) and `post-deploy`.
- Thresholds and rules live here; sites configure only pages, forms and site URL
  in `ship-gate.config.json`.
- Threshold overrides require a reason and a restore date, and expire.
- Guards: PostHog server-side only, EU host, no `PUBLIC_` key, no hard-coded
  key, direct use only in server paths, every event tagged `__DEPLOY_ENV__`;
  every tag through Zaraz, no sGTM; Turnstile on every form; no committed env
  files; Workers not Pages; Node pinned.
- Contract check: standard npm scripts, required dev dependencies, and no
  leftover local kit copies.
- `self-test`: 24 fixture cases proving every guard and config rule fires.
