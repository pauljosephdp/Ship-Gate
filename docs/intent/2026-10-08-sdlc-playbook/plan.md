# Plan: adopt the AI-Native SDLC Playbook (from spec.md 2026-10-08)

## Files that change
**Ship Gate**
- `CLAUDE.md`.
- New: `REVIEW.md`, `.github/CODEOWNERS`.
- New: `.claude/settings.json`, `.claude/protected-tests.txt`, `.claude/hooks/{guard-bash,protect-tests,lint-shell}.sh`.
- New workflow: `.github/workflows/ci-health.yml`.
- New action: `ci-health/action.yml`.
- New agents: `.claude/agents/{verifier,reviewer}.md`.
- New script: `scripts/ci-health.mjs`, with tests in `test/ci-health.test.mjs`.
- `scripts/check-readme.sh`: check every `Ship-Gate/<path>@v` pin.
- `scripts/self-test.sh`: add cases for the hooks and the workflows.
- New evals: `evals/*.json`, `evals/run.sh`, `evals/threshold`.
- New: `docs/intent/` (README, `_template/`, and this change).

**Caller templates**
- Version pins only.

**README and CHANGELOG**
- README: an AI-native SDLC section.
- CHANGELOG: v3.13.0.

**Sites**
- One PR per site, adding the `sharp` override (routine, auto-merge after `npm run gate` and a reviewer TALLY).
- Then one PR on `pauljosephdp/Skills`: `sync-ship-gate.mjs` to v3.13.0 and the `sharp` fix, rolled out by `ops/upgrade-all.yml`.

## Order of work
1. Hooks, with their tests.
2. `ci-health.mjs`, tests first.
3. Actions and workflows, with actionlint.
4. Evals.
5. Docs.
6. The PR, then the release.
7. The site PRs.

Departures, 2026-10-08 (spec.md, Areas of concern):
- The site templates were dropped, and `docs/changes/` became `docs/intent/`.
- The key-backed jobs (`claude.yml`, the `triage` action, `agent-evals.yml`) were removed to keep no model in CI.
- Site pins go through web-baseline.

## Risks
- **Hooks too broad:** they could stall sessions. Self-test checks the allowed commands as well as the blocked ones.
- **Site pin PRs racing Dependabot:** Dependabot opens the same Ship Gate bump. The site PR pins v3.13.0, and Dependabot closes its PR as superseded.

## Proof
- Self-test reports 0 failed.
- ShellCheck and actionlint are clean.
- `node --test` passes.
- `check-readme.sh origin/main` passes.
- After the merge, tag v3.13.0 and its release exist.
- Each site PR's `verify` is green, and its `verify` time drops.
