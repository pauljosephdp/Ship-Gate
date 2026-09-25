# Ship Gate — instructions for Claude

## When a piece of work is complete

Every time, without asking:

1. Run `bash scripts/self-test.sh` and `shellcheck -S error scripts/*.sh test/*.sh`; both must pass.
2. Add a `CHANGELOG.md` entry when the change affects site repos (see README → Changing Ship Gate for major/minor/patch).
3. Commit, push the working branch, and open a pull request against `main`.
4. Watch the PR. Fix any red check (`self-test`, every `fixture` variant) and push again until all are green.
5. When every check is green and there is no merge conflict, merge the PR (squash). The `release` job then publishes the version automatically.
6. Confirm the release when the merge adds a new `## vX.Y.Z` heading to `CHANGELOG.md`. Wait for the Self-test run on `main` for the merge commit, then check that tag `vX.Y.Z` and its GitHub release exist at that commit. If they are missing:
   - If the run was cancelled, or the `release` job was skipped, run the Self-test workflow on `main` by hand (workflow_dispatch). It re-runs every check, then releases.
   - If a check or the `release` job failed, find the cause in the job log. Fix it through a PR (steps 1–5), then check again.
   - Report the tag to the user only once it exists.

Never push to `main` directly, skip or disable a test to get green, merge a red PR, or create or move a release tag by hand. Only the `release` job tags, so only green commits get tagged.
