<!-- Ship Gate: merge these sections into the site's CLAUDE.md (keep the site's own rules; keep the file under a page). -->

## Verifying your work
- Types: `npm run check` (0 errors)
- Lint and tests: `npm run lint` and `npm test`, when the site has them (all green; never skip or delete a failing test)
- Build: `npm run build` (completes, no warnings about missing pages)
- Ship Gate: `verify` on the pull request runs everything else (scans, browser suite, Lighthouse)

Run them before reporting any task complete and paste the output; use the `verifier` subagent for a second look. If a test fails, fix the code, not the test (`.claude/protected-tests.txt` needs a person's approval to change an existing test).

## How a change starts
`docs/changes/YYYY-MM-DD-name/` (copy `_template/`): `intent.md`, then `spec.md` for anything a visitor will notice (apply the brand, security and UX skills), then `plan.md` in plan mode before code. Update `plan.md` in the same commit when the work departs from it. The PR links the folder; review checks the diff against it (`REVIEW.md`).

## Guardrails
Everything runs in the cloud (GitHub Actions, Cloudflare Workers Builds, Claude Code cloud sessions). `.claude/hooks/guard-bash.sh` blocks pushes to main, tags and releases, and wrangler production writes: Workers Builds deploys `main`, and a rollback or a secret is a person's call in the dashboard.

## Things Claude gets wrong
<!-- When Claude makes the same mistake twice, add the correction here. -->
