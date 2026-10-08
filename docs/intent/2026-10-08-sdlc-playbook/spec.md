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
- `agent-evals.yml` runs them when the configuration changes, and weekly. It fails below `evals/threshold`.

**Deploy: PR review**
- `REVIEW.md`, with a `TALLY:` line like web-baseline's.
- `claude.yml` reviews ready PRs and answers `@claude`.
- `CODEOWNERS` names the approver.

**Deploy: CI/CD**
- The `triage/` action, and a `triage` job in Self-test.

**Maintain**
- The `ci-health/` action, with `scripts/ci-health.mjs`.
- A weekly `ci-health.yml` over Self-test.

**Sites**
- Each site moves its Ship Gate pins to v3.13.0, which also brings v3.12.0's faster `verify`.
- That is one PR per site, following its `CLAUDE.md` (web-baseline's release policy).

## Areas of concern
**web-baseline already implements the playbook in every site.** Found during the build.
- **What the sites have:** `docs/intent/`, a `REVIEW.md` with TALLY, the `guard.mjs` hooks (plan-sync, verify-done), agents and skills, `maintain-loop.yml` (production control bands), `revert-on-red.yml` (the rollback runbook) and `critical-gate.yml`.
- **Why they can't take Ship Gate's copies:** these are standard files, checked by a strict conformance gate. Copying Ship Gate's versions in would duplicate them or fail that gate.
- **Decision (owner, 2026-10-08):** sites get a pin bump only, and Ship Gate drops its site templates.

**Proposed to web-baseline** (owner: Paul; not done by hand in the sites):
1. Add CI-duration bands to `maintain-loop.yml`. It samples production today, not `verify`. Ship Gate's `ci-health` action does this. On real history it flags Playway, with three runs at 27.8–30.4 minutes.
2. There is no second proposal: web-baseline already ships failed-build triage and agent evals as opt-in workflows (`agent-triage.yml`, `agent-evals.yml`, `tests/evals/`). A site turns them on through its standard.

**Rollback rehearsal**
- Ship Gate's `self-test` exercises the rollback path against a stub `wrangler`.
- web-baseline's `revert-on-red.yml` is the runbook.
- There is no staging, and no Cloudflare tokens may sit in workflows.

**Cost**
- Reviews run only on ready PRs.
- Evals run on configuration change, and weekly.
- Triage runs only on failure.
- The diagnosis runs only at tier 2 or above.

## Out of scope
- Org-wide managed settings.
- Claude Tag.
- OpenTelemetry export.
