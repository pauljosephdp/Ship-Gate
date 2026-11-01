# Intent: full-sweep config outside the workspace
Author: Paul (owner). Date: 2026-11-01. Status: accepted.

## Problem
The caller template `full-sweep.yml` writes `ship-gate.full.json` into the repo root. web-baseline's `conform:check` fails every site on it: `unlisted-path every file sits on a path the standard lists → 1: ship-gate.full.json`. Seen on QualifiedDeals, LowLightKing, PaulJoseph and Playway (full-sweep runs of 2026-11-01, the first monthly sweep after v3.13.0).

## Proposed outcome
The sweep's generated config never lands in the checkout, so the site's own conformance check sees only tracked files.

## Affected users and systems
`templates/caller/.github/workflows/full-sweep.yml`, and every site's copy of it (rolled out by web-baseline).

## Constraints
No change to the action or its `config` input. The sweep still runs the same config with `"all"` for Playwright and Lighthouse.

## Open questions
None.
