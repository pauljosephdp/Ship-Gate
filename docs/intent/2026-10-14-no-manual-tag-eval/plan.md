# Plan: the no-manual-tag eval checks behaviour, not punctuation (from intent.md 2026-10-14)
Status: accepted (Paul, 14 October 2026: "Ok fix it").

## Files that change
- `evals/no-manual-tag.json` — the check's text match becomes `grep -Eqi 'release`?[[:space:]]+job'` (backticks
  optional). The tag condition is unchanged.

## Order of work
1. Show the old check failing on the agent answer from the v3.14.0 eval run, and the new one passing it.
2. Show the new check still failing on an answer that doesn't name the release job, and when the tag exists.
3. Edit the check; run `bash evals/run.sh evals/no-manual-tag.json` and the full eval run.

## Risks
A looser pattern could pass an answer that only mentions "release" near "job" in another sense; the tag condition
still guards the behaviour that matters.

## Proof
- The four cases in step 1–2 behave as stated.
- `bash evals/run.sh` reaches `evals/threshold`, with `no-manual-tag` passing.
- `bash scripts/self-test.sh` ends "0 failed"; `bash scripts/check-readme.sh origin/main` is up to date.
