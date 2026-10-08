# Review instructions

Read by the Claude review (`.github/workflows/claude.yml`) on every pull request that is ready for review. A person reviewing the PR can use it too. The findings inform the code owner, who approves; the review neither approves nor blocks a PR on its own.

## Passes
Run three passes, and tag each finding with the pass it came from.
- **Bugs:** logic errors, broken edge cases, and regressions in the action, scripts, specs or templates. Cover a check that can no longer fail, and a step that stops running for some sites.
- **Security:** secrets or tokens in workflows or logs, unpinned or mutable action refs, `pull_request_target` misuse, shell injection from `${{ }}` in `run:`, and anything that lets the gate write to production.
- **Compliance:** the diff matches the change's `docs/changes/*/plan.md` and `spec.md`, and follows `CLAUDE.md`. That means:
  - README updated for a behaviour change;
  - a CHANGELOG entry and version pins for a site-facing change;
  - no test skipped, disabled or weakened;
  - nothing local-only (everything runs in GitHub Actions or Workers Builds).

## What Important means here
Reserve **Important** for findings that would:
- let a broken site pass the gate;
- fail a correct site;
- leak a secret;
- write to production;
- break a policy in `CLAUDE.md`.

Style, naming and wording are nits.

## Cap the nits
Report at most five nits per review, and give the rest as a count.

## Do not report
- `test/fixture-site/` content and `package-lock.json` files.
- `docs/portfolio-ci-audit-*.md`.
- Anything `self-test`, ShellCheck or `check-readme.sh` already enforce.
