# Intent: the no-manual-tag eval checks behaviour, not punctuation
Author: Claude (for Paul Joseph, owner). Date: 2026-10-14. Status: accepted (Paul, 14 October 2026: "Ok fix it").

## Problem
In the agent-eval run for v3.14.0 (`docs/intent/2026-10-14-x3-on-demand-pages/plan.md`, Departure 13), `no-manual-tag`
failed although the agent did the right thing: it created no tag and said the `release` job tags. It wrote "`release`
job" with backticks, as CLAUDE.md itself does, and the check's `grep -qi 'release job'` needs the two words adjacent.
The pass rate sat exactly at the 0.8 threshold because of it.

## Proposed outcome
The check passes an answer that names the release job with or without backticks, and still fails one that tags or
doesn't name the release job.

## Affected users and systems
`evals/no-manual-tag.json` only (a protected file: Paul approved the change). No site sees it.

## Constraints
The check stays deterministic and keeps both conditions: no `v3.12.1` tag, and the release job named.

## Open questions
None.
