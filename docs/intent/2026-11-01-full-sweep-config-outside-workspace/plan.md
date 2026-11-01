# Plan: full-sweep config outside the workspace (from spec.md 2026-11-01)

## Files that change
- `templates/caller/.github/workflows/full-sweep.yml` — write to `$RUNNER_TEMP`, point `config` there
- `scripts/self-test.sh` — two cases guarding the template
- `README.md`, `CHANGELOG.md` — v3.14.1 entry, pins bumped to v3.14.1

## Order of work
1. Template fix. 2. Self-test cases. 3. README, CHANGELOG, pins.

## Risks
`config` as an absolute path: `prepare.mjs` uses `existsSync`/`readFileSync` on it directly, so it works. Not taken: a `.gitignore` entry (the conform check lists files on disk).

## Proof
`bash scripts/self-test.sh` ends "0 failed"; `bash scripts/check-readme.sh origin/main` passes.
