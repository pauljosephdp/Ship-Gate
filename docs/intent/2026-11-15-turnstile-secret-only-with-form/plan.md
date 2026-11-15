# Plan: Turnstile secret only with a Turnstile form (v4.0.1)

## Files that change
- `scripts/guards.sh`: `posthog-secrets` adds the Turnstile secret only when the scan finds a Turnstile marker in `src`;
  the scan (and guard 3b's) is case-insensitive, as guard 3's per-file check already is
- `scripts/gate-rules.mjs`: the `posthog-secrets` description says the Turnstile secret is needed only with a form
- `scripts/self-test.sh`: with `turnstile-forms` and no form, no Turnstile secret is needed; `POSTHOG_API_KEY` still is
- `README.md`, `CHANGELOG.md`: v4.0.1 entry and wording; pins bumped to v4.0.1

## Order of work
1. Failing self-test case first (it fails on v4.0.0). 2. Guard fix. 3. Description, README, CHANGELOG, pins.

## Risks
A scan match outside a form (a comment, CSS) keeps the secret required, which is the old behaviour, so nothing gets
looser than v4.0.0 except for sites with no marker at all.

## Proof
`bash scripts/self-test.sh` ends "0 failed"; shellcheck prints nothing; `bash scripts/check-readme.sh origin/main` passes;
v4.0.1's guards pass on Playway's upgrade branch, where v4.0.0's fail with "secrets.required lacks TURNSTILE_SECRET_KEY".
