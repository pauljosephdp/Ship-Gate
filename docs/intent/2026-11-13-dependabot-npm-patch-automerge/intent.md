# Intent: Dependabot npm patch PRs merge themselves
Author: Paul (owner). Date: 2026-11-13. Status: accepted.

## Problem
Paul does not want a dependency bot holding a PR. On 2026-11-13, six web-baseline sites (Playway #116, Cocoon #90, Gallivant #61, FrametoFunnel #70, TargetPrice #181, MinuJoseph #22) had the same Dependabot npm patch group open since 5 Nov. Every check was green and the PRs were mergeable, but auto-merge was off. The caller `dependabot-auto-merge.yml` queues only Ship Gate bumps ("npm updates are left alone"). web-baseline's `critical-gate` classes an npm bump as routine, and for a routine PR "the session enables auto-merge". A Dependabot PR has no session, so nothing enabled it.

## Proposed outcome
A Dependabot npm PR whose update type is patch (the only npm type web-baseline's D8 lets Dependabot open) merges itself once `verify` passes, with no person involved. npm minors and majors, and Ship Gate majors, still wait.

## Affected users and systems
`templates/caller/.github/workflows/dependabot-auto-merge.yml`, so every site through web-baseline's `sync-ship-gate.mjs`. README step 15.

## Constraints
- Auto-merge never bypasses the ruleset's required `verify`.
- The workflow keeps running on `pull_request_target` and never checks out the PR.
- Paul chose `AUTOMATION_TOKEN` (stored as a Dependabot secret), so the merge starts `main`'s workflows; without it the workflow falls back to the workflow token.

## Open questions
None.
