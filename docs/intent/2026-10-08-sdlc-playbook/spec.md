# Spec: adopt the AI-Native SDLC Playbook (from intent.md 2026-10-08)

## Requirements: plays and how Ship Gate adopts each
**Plan, Design, Build (intent, spec, plan)**
- Each change gets `docs/intent/YYYY-MM-DD-name/{intent,spec,plan}.md`, from `_template/`. This is the same layout as web-baseline.
- `CLAUDE.md` requires these files. `REVIEW.md` checks the diff against `plan.md`.

**Build: CLAUDE.md**
- Add Commands with their healthy output, How a change starts, Conventions, and "Things Claude gets wrong".

**Build: hooks** (`.claude/hooks/`)
- `guard-bash.sh` blocks pushes to main, force pushes, `--no-verify`, tags, releases, `gh pr merge --admin`, and wrangler production writes.
- `protect-tests.sh` asks a person before an existing test changes.
- `lint-shell.sh` runs ShellCheck on edits.

**Build: subagents**
- `.claude/agents/verifier.md` checks and reports only.

**Test: evals**
- `evals/*.json` hold real tasks, each with a deterministic check.
- `bash evals/run.sh` runs them in a cloud session when the configuration changes. The pass rate must reach `evals/threshold`.
- No CI job runs the evals, as in web-baseline.

**Deploy: PR review**
- `REVIEW.md`, with a `TALLY:` line like web-baseline's.
- The session's `reviewer` subagent runs the passes before the first push, and the push waits for `important=0`.
- `CODEOWNERS` names the approver.

**Deploy: CI/CD**
- A red run is fixed from a cloud session. No model runs in CI.

**Maintain**
- The `ci-health/` action, with `scripts/ci-health.mjs`. Tier 2 and 3 open an `intent.md` issue, and no model runs.
- A weekly `ci-health.yml` over Self-test.

**Sites**
- The pins are web-baseline template lines, so conformance fails a hand-made bump; this was confirmed on MinuJoseph. Sites therefore move to v3.13.0 through a web-baseline release in `pauljosephdp/Skills`, rolled out by `ops/upgrade-all.yml`.
- Every site fails `audit:deps` on `main` (GHSA-wq5f-xc86-pv6w, `sharp` <0.35.5, pulled in through miniflare). Each site gets one PR adding `"overrides": {"sharp": "0.35.5"}`. This passes conformance.

## Areas of concern
**web-baseline already implements the playbook in every site.** Found during the build.
- **What the sites have:** `docs/intent/`, a `REVIEW.md` with TALLY, the `guard.mjs` hooks (plan-sync, verify-done), agents and skills, `maintain-loop.yml` (production control bands), `revert-on-red.yml` (the rollback runbook) and `critical-gate.yml`.
- **Why they can't take Ship Gate's copies:** these are standard files, checked by a strict conformance gate. Copying Ship Gate's versions in would duplicate them or fail that gate.
- **Decision (owner, 2026-10-08):** sites get a pin bump only, and Ship Gate drops its site templates.

**Proposed to web-baseline** (owner: Paul; not done by hand in the sites):
1. Add CI-duration bands to `maintain-loop.yml`. It already bands production and the CI failure rate, but not how long `verify` takes. Ship Gate's `ci-health` action does this. On real history it flags Playway, with three runs at 27.8–30.4 minutes.
2. Adopt Ship Gate v3.13.0 (`sync-ship-gate.mjs`) and fix the `sharp` advisory in the standard. The per-site `sharp` override PRs are the stopgap.

**Rollback rehearsal**
- Ship Gate's `self-test` exercises the rollback path against a stub `wrangler`.
- web-baseline's `revert-on-red.yml` is the runbook.
- There is no staging, and no Cloudflare tokens may sit in workflows.

**No model in CI** (owner, 2026-10-08)
- web-baseline removed the Anthropic key from the delivery chain.
- Ship Gate follows it: no `claude.yml`, no triage action, and no CI eval job.
- Self-test fails if a workflow calls Claude.

## Out of scope
- Org-wide managed settings.
- Claude Tag.
- OpenTelemetry export.
