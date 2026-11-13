# Spec: Dependabot npm patch PRs merge themselves (from intent.md 2026-11-13)

## Requirements
1. A `dependabot[bot]` PR where fetch-metadata reports `package-ecosystem == npm_and_yarn` and `update-type == version-update:semver-patch` is queued with `gh pr merge --auto --squash`.
2. npm minor or major PRs are not queued.
3. The Ship Gate rule is unchanged: minor or patch are queued, major waits.
4. `GH_TOKEN` is `secrets.AUTOMATION_TOKEN || github.token`.
5. The self-test asserts requirements 1, 2 and 4 (`cost_case`), next to the existing auto-merge cases.

## Design
Widen the existing step's `if:` with an `||` branch. The job id stays `ship-gate`, so the check-run name sites already see does not change. For a grouped PR, fetch-metadata v3 reports the group's largest move, so a group holding one minor is not queued.

## Areas of concern
- A merge made with the workflow token does not start `main`'s push workflows. Resolved by Paul's choice of `AUTOMATION_TOKEN` as a Dependabot secret. The README says so, and the fallback is documented.
- Patch releases can still break a build. `verify` (build, tests, Lighthouse, scans) runs before the merge, and a red bump stays open.

## Out of scope
Security-update detection (needs `alert-lookup` and a token with security-events read). npm minors (web-baseline D8 moves them through a skill release).
