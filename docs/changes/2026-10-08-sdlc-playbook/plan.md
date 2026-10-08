# Plan: adopt the AI-Native SDLC Playbook (from spec.md 2026-10-08)

## Files that change
**Ship Gate itself**
- `CLAUDE.md`: Commands, How a change starts, Conventions, Things Claude gets wrong.
- New: `REVIEW.md`, `.github/CODEOWNERS`, `.claude/settings.json`, `.claude/protected-tests.txt`, `.claude/agents/verifier.md`.
- New workflows: `.github/workflows/claude.yml`, `ci-health.yml`, `agent-evals.yml`.
- `self-test.yml`: a `triage` job, and `ci-health.mjs` left out of the fixture trigger.
- New actions: `ci-health/action.yml` and `triage/action.yml`.
- New script: `scripts/ci-health.mjs`, unit tested in `test/ci-health.test.mjs`.
- `scripts/check-readme.sh`: the pin check covers every `Ship-Gate/<path>@v`.
- `scripts/self-test.sh`: hook, template and workflow cases.
- New evals: `evals/*.json`, `evals/run.sh`, `evals/threshold`.
- New change records: `docs/changes/` (README, `_template/`, this change).

**Caller templates**
- New: `templates/caller/.claude/` (hooks, settings, protected tests, verifier), `REVIEW.md`, `.github/CODEOWNERS`, `docs/changes/`, `CLAUDE.playbook.md`.
- New workflows: `.github/workflows/claude.yml` and `ci-health.yml`.
- `ci.yml`: a `triage` job.
- Pins bumped to v3.13.0.

**Release notes**
- README: the AI-native SDLC section, the "What lives where" rows and adoption step 16.
- CHANGELOG: v3.13.0.

**Then, one PR per site** (8 repos), after v3.13.0 is released:
- Copy the template files and merge `CLAUDE.playbook.md` into the site's `CLAUDE.md`.
- Set `protected-tests.txt` to the site's own test paths.
- Pin v3.13.0, and follow each repo's own `CLAUDE.md`.

## Order of work
1. Hooks first, each case tested.
2. Templates and Ship Gate's own wiring.
3. `ci-health.mjs`, tests first.
4. Actions and workflows, linted with actionlint.
5. Evals.
6. Docs, then the PR.
7. After the release, the site PRs.

## Risks
- **Hooks too broad:** a hook that blocks a legitimate command stalls every session. Self-test covers allowed commands as well as blocked ones.
- **Review cost and noise:** mitigated by ready-only triggers, the nit cap and skipping drafts.
- **Missing secret:** without the key, the Claude jobs pass with a notice.
- **Site PRs vs Dependabot:** a site PR can collide with Dependabot's v3.12.0/v3.13.0 bump PR. The site PR pins v3.13.0 directly, and Dependabot closes its own PR as superseded.

## Proof
- `bash scripts/self-test.sh` ends with 0 failed.
- ShellCheck is clean on the scripts and hooks.
- `actionlint` is clean on the workflows.
- `node --test test/*.test.mjs` passes.
- `bash scripts/check-readme.sh origin/main` passes.
- After merge: tag v3.13.0 and its release exist, and each site PR's `verify` is green.
