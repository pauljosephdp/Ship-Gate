# Plan: back button hijacking fails the gate (from spec.md 2026-11-15)

## Files that change
- `e2e/helpers.ts` — `installHistoryProbe`.
- `e2e/page.spec.ts` — the probe on desktop; the `history:` soft assertion at the end of the page test.
- `scripts/results.mjs` — `browser:history` (SEO, error).
- `test/break-fixture.sh`, `test/expect-gate.sh`, `.github/workflows/self-test.yml` — variant `back-button-hijack`
  (browser group, slot v9), expected to fail "Smoke, axe, reflow, CSP, edge".
- `README.md`, `CHANGELOG.md`, caller templates — the History check, `browser:history`, v4.2.0 pins.

## Order of work
1. Probe and assertion. 2. Result id. 3. Fixture variant and expectation. 4. Docs and pins.

## Risks
A site with a script that pushes state on load goes red on its next Ship Gate bump; web-baseline's canary runs v4.2.0
on every site before the pin moves, so it shows there first.

## Proof
- Browser suite on the fixture (verifier step 4): `conforming` passes (14/14); `back-button-hijack` fails only
  `/: history: the page added 2 history entries…`, 13 others pass.
- `bash scripts/self-test.sh`, `shellcheck -S error …`, `bash scripts/check-readme.sh origin/main`.
- The fixture jobs on the ready PR: browser group v9 fails as expected.
