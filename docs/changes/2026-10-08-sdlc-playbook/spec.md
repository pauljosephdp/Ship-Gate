# Spec: adopt the AI-Native SDLC Playbook (from intent.md 2026-10-08)

## Requirements: plays and how each is adopted
**Plan, Design (intent and spec)**
- `docs/changes/YYYY-MM-DD-name/{intent,spec,plan}.md`, from `_template/`.
- `CLAUDE.md` requires them, and `REVIEW.md` checks the diff against `plan.md`.

**Build (plan mode)**
- `plan.md` is committed. When the work departs from it, it is updated in the same commit.

**Build (CLAUDE.md)**
- Ship Gate's `CLAUDE.md` gains Commands with healthy output, Conventions, and "Things Claude gets wrong", and stays under a page.
- Sites get a section to merge into their own `CLAUDE.md`.

**Build (skills)**
- The sites' brand and review skills already exist; they are org plugins.
- Ship Gate's rules live in `CLAUDE.md` and are backed by hooks and CI. No new skill is needed.

**Build (hooks as guardrails)** in `.claude/hooks/`:
- `guard-bash.sh` blocks:
  - pushes to main, force-pushes and `--no-verify`;
  - tags and releases;
  - `gh pr merge --admin`;
  - wrangler production writes.
- `protect-tests.sh` asks a person before an existing test changes.
- `lint-shell.sh` runs ShellCheck on an edited script.

**Build (subagents)**
- `.claude/agents/verifier.md` runs the checks and reports only.

**Test (feedback loop)**
- `CLAUDE.md` has a verification block, and the test-edit hook protects it.

**Test (continuous evals)**
- `evals/*.json` are tasks from real Ship Gate work, each with a deterministic check.
- `.github/workflows/agent-evals.yml` runs them when `CLAUDE.md`, `REVIEW.md` or `.claude/**` changes, and weekly. A PR fails if the pass rate drops below `evals/threshold`.

**Deploy (AI in PR review)**
- `.github/workflows/claude.yml` reviews against `REVIEW.md` when a PR is opened, ready or updated (not drafts), and answers `@claude` mentions.
- Branch protection plus `CODEOWNERS` make a person approve.

**Deploy (hooks as approval gates)**
- The same `guard-bash.sh` hook in every repo.
- Managed settings are an org-admin step, documented in the README.

**Deploy (CI/CD)**
- A read-only `claude -p` triage job runs after a failed `self-test`/`fixture` (Ship Gate) or `verify` (sites), and posts a three-line diagnosis on the PR.

**Maintain (closing the loop)**
- `scripts/ci-health.mjs` is deterministic and unit tested.
  - It computes control bands over the last 30 runs: the mean and σ of duration and the failure rate, with Western Electric rule 1 (one run beyond 3σ) and rule 2 (2 of 3 beyond 2σ), plus a run within 20% of the job timeout.
  - The tiers are: 1σ logs; 2σ asks Claude to diagnose, read-only, in the job summary; 3σ or near the timeout opens an issue in `intent.md` form.
- `ci-health.yml` runs weekly in every repo.

## Areas of concern
- **Rollback rehearsal:** not adopted as a CI job. The `workers-builds-only` policy forbids Cloudflare tokens in workflows, and the sites deploy production only.
  - The rollback path (`ship-gate-after-deploy.sh`, `SHIP_GATE_ROLLBACK=1`) stays exercised by self-test against a stub `wrangler` on every Ship Gate change. Owner: Paul.
- **Cost:** each eval, review and triage call spends API credit.
  - Reviews run only on ready PRs and on new pushes to them.
  - Evals run only when the agent's configuration changes, and weekly.
  - Triage runs only on failure.

## Out of scope
- Org-wide managed settings, Claude Tag in Slack, OpenTelemetry export.
