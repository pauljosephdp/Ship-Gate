# Plan: axe waits for late scroll-driven transitions
Spec: spec.md. Status: accepted (Paul, 11 October 2026).

## Files that change
| File | What |
|---|---|
| `e2e/helpers.ts` | `settle()`: three frames after the scroll back, then two quiet polls (spec 1, 2) |
| `README.md`, `CHANGELOG.md`, `templates/caller/.github/workflows/*.yml` | Axe bullet, v3.13.1 entry and pins (spec 3) |
| `docs/intent/2026-10-11-settle-late-transitions/*` | This chain |

## Order of work
1. Reproduce on Gallivant's home page with the old `settle()` sequence and axe at 1440 × 900 (5 of 5 fail).
2. Apply the change; the same reproduction passes (0 of 8 fail).
3. Self-test, ShellCheck, README check; reviewer subagent to `TALLY: important=0`; draft PR, then ready.

## Risks and proof
- The fixture browser suite (`fixture (browser)`) must stay green: conforming passes, broken variants fail.
- After release, Dependabot's monthly Ship Gate bump (or web-baseline's sync) brings v3.13.1 to the sites.
