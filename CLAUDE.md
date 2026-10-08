# Ship Gate — instructions for Claude

## Commands (healthy output)
- Self-test: `bash scripts/self-test.sh`. It ends with "Self-test: N passed, 0 failed."
- ShellCheck: `shellcheck -S error scripts/*.sh test/*.sh .claude/hooks/*.sh`. It prints nothing.
- README check: `bash scripts/check-readme.sh origin/main`. It prints "README.md is up to date."
- Browser suite on the fixture: see `.claude/agents/verifier.md`, step 4. Conforming passes, and each broken variant fails on its own check.
- Agent evals: `bash evals/run.sh`, run in this cloud session (no CI job, no API key) whenever `CLAUDE.md`, `REVIEW.md` or `.claude/` changes. The pass rate must reach `evals/threshold`.

Run them before reporting any task done, and paste the output. Use the `verifier` subagent for a second check in a fresh context, and the `reviewer` subagent for the `REVIEW.md` pass: the push waits for `TALLY: important=0`. If a test fails, fix the code, not the test. `.claude/protected-tests.txt` lists the tests that need a person's approval to change.

## How a change starts
1. Create `docs/intent/YYYY-MM-DD-name/` and copy the files from `_template/`.
2. Write `intent.md`.
3. Write `spec.md` for anything a site will notice.
4. Write `plan.md` in plan mode before writing code.
5. When the work departs from the plan, update `plan.md` in the same commit.
6. Link the folder in the PR. The review checks the diff against `plan.md` (`REVIEW.md`).

## Conventions
- Everything runs in the cloud: GitHub Actions, Workers Builds and Claude Code cloud sessions. Never tell anyone to run something "locally" or on their own machine.
- No model runs in CI and no Anthropic key exists in this repo, as in web-baseline: review, triage and evals are cloud-session work.
- Nothing in the gate, the CI or a session writes to production. The `.claude/hooks/guard-bash.sh` hook blocks this, together with pushes to main, tags and releases.
- Sites get Ship Gate through `templates/caller/`, adopted by web-baseline (`pauljosephdp/Skills`, `references/ship-gate.json` and `scripts/sync-ship-gate.mjs`), which rolls a new version out to every site. A template change is a site-facing change. The sites run web-baseline, which brings their own playbook files (`docs/intent/`, `REVIEW.md`, `.claude/`); never copy Ship Gate's into a site.

## Things Claude gets wrong
- Forgetting a version pin. `check-readme.sh` checks every `Ship-Gate…@vX.Y.Z`: in the README, and in the caller workflows.
- Calling a failure "flaky". Find the cause.
- When Claude makes the same mistake twice, add it here and add an eval for it in `evals/`.

## When a piece of work is complete

Every time, without asking:

1. Run the Commands above. Each must show its healthy output.
2. Update `README.md` in the same PR for every change to what Ship Gate does: the action, `post-deploy/`, `ci-health/`, `scripts/`, `e2e/`, `templates/`, `tools/` and workflows. Describe the new behaviour where a reader would look for it, and bump the version pins when you add a CHANGELOG version. `bash scripts/check-readme.sh origin/main` must pass. It runs in `self-test`, so a PR without the README update goes red.
3. Add a `CHANGELOG.md` entry when the change affects site repos (see README → Changing Ship Gate for major/minor/patch).
4. Commit, push the working branch, and open a **draft** pull request against `main`. Keep pushing to the draft while you iterate: only `self-test` runs there (about a minute), the fixture jobs don't. Mark it ready for review once the work is final and the checks in step 1 pass; the fixture jobs then run once. Each ready-PR push costs a full run (about 12 minutes), so batch fixes into one push.
5. Watch the PR. Fix any red check (`self-test`, `fixture (browser)`, `fixture (scans)`) and push again until all are green.
6. Enable auto-merge (squash) on the PR once it is ready, so it merges itself when every check is green; the branch is deleted on merge. If auto-merge is not available on the repo, merge it (squash) yourself as soon as every check is green and there is no merge conflict. The `release` job then publishes the version automatically.
7. Confirm the release when the merge adds a new `## vX.Y.Z` heading to `CHANGELOG.md`. Wait for the Self-test run on `main` for the merge commit, then check that tag `vX.Y.Z` and its GitHub release exist at that commit. If they are missing:
   - If the run was cancelled, or the `release` job was skipped, run the Self-test workflow on `main` by hand (workflow_dispatch). It re-runs every check, then releases.
   - If a check or the `release` job failed, find the cause in the job log. Fix it through a PR (steps 1–6), then check again.
   - Report the tag to the user only once it exists.

Never push to `main` directly, merge a change to Ship Gate's behaviour without a README update, skip or disable a test to get green, merge a red PR, or create or move a release tag by hand. Only the `release` job tags, so only green commits get tagged.
