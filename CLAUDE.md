# Ship Gate — instructions for Claude

## When a piece of work is complete

Every time, without asking:

1. Run `bash scripts/self-test.sh` and `shellcheck -S error scripts/*.sh test/*.sh`; both must pass.
2. Update `README.md` in the same PR for every change to what Ship Gate does: the action, `post-deploy/`, `scripts/`, `e2e/`, `templates/`, `tools/` and workflows. Describe the new behaviour where a reader would look for it, and bump the version pins when you add a CHANGELOG version. `bash scripts/check-readme.sh origin/main` must pass. It runs in `self-test`, so a PR without the README update goes red.
3. Add a `CHANGELOG.md` entry when the change affects site repos (see README → Changing Ship Gate for major/minor/patch).
4. Commit, push the working branch, and open a **draft** pull request against `main`. Keep pushing to the draft while you iterate: only `self-test` runs there (about a minute), the fixture jobs don't. Mark it ready for review once the work is final and the local checks in step 1 pass; the fixture jobs then run once. Each ready-PR push costs a full run (about 12 minutes), so batch fixes into one push.
5. Watch the PR. Fix any red check (`self-test`, `fixture (browser)`, `fixture (scans)`) and push again until all are green.
6. When every check is green and there is no merge conflict, merge the PR (squash). The `release` job then publishes the version automatically.
7. Confirm the release when the merge adds a new `## vX.Y.Z` heading to `CHANGELOG.md`. Wait for the Self-test run on `main` for the merge commit, then check that tag `vX.Y.Z` and its GitHub release exist at that commit. If they are missing:
   - If the run was cancelled, or the `release` job was skipped, run the Self-test workflow on `main` by hand (workflow_dispatch). It re-runs every check, then releases.
   - If a check or the `release` job failed, find the cause in the job log. Fix it through a PR (steps 1–6), then check again.
   - Report the tag to the user only once it exists.

Never push to `main` directly, merge a change to Ship Gate's behaviour without a README update, skip or disable a test to get green, merge a red PR, or create or move a release tag by hand. Only the `release` job tags, so only green commits get tagged.
