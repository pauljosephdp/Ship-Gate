# Plan: Dependabot npm patch PRs merge themselves (from spec.md 2026-11-13)

## Files that change
- `scripts/self-test.sh`: three `cost_case` lines (committed first, failing) and, after review, a negative check that the npm clause names no minor or major.
- `.gitignore`: `*.whl` (review: a tool wheel was nearly committed).
- `templates/caller/.github/workflows/dependabot-auto-merge.yml`: header, `if:`, `GH_TOKEN`.
- `README.md`: file table row, step 15, pins and the Play row to v3.15.0.
- `templates/caller/.github/workflows/{ci,full-sweep,post-deploy}.yml`: pins to v3.15.0.
- `CHANGELOG.md`: v3.15.0 (minor: a conforming site needs no change to keep passing).

## Order of work
1. Add the failing tests. 2. Change the template. 3. Update the README, pins and CHANGELOG. 4. Self-test, ShellCheck, README check. 5. Draft PR, then ready once green. Auto-merge, then the release job tags v3.15.0.

## Risks
The `if:` grouping. A wrong parenthesis would queue npm minors or Ship Gate majors. The self-test asserts the patch-only branch. Review reads the expression.

## Proof
- `bash scripts/self-test.sh` → `Self-test: N passed, 0 failed` (3 new cases failed before the template change: 560 passed, 3 failed).
- `shellcheck -S error scripts/*.sh test/*.sh .claude/hooks/*.sh` → no output.
- `bash scripts/check-readme.sh origin/main` → `README.md is up to date.`
