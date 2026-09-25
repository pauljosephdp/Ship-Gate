# Ship Gate — instructions for Claude

## When a piece of work is complete

Every time, without asking:

1. Run `bash scripts/self-test.sh` and `shellcheck -S error scripts/*.sh test/*.sh`; both must pass.
2. Add a `CHANGELOG.md` entry when the change affects site repos (see README → Changing Ship Gate for major/minor/patch).
3. Commit, push the working branch, and open a pull request against `main`.
4. Watch the PR. Fix any red check (`self-test`, every `fixture` variant) and push again until all are green.
5. When every check is green and there is no merge conflict, merge the PR (squash). The `release` job then publishes the version automatically.

Never push to `main` directly, skip or disable a test to get green, or merge a red PR.
