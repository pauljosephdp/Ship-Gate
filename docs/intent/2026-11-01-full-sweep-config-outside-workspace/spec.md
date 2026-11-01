# Spec: full-sweep config outside the workspace (from intent.md 2026-11-01)

## Requirements
1. `full-sweep.yml` writes the generated config under `$RUNNER_TEMP`, never the workspace.
2. The action's `config` input points at that file (an absolute path, which `prepare.mjs` reads as given).
3. `self-test` fails if the template writes `ship-gate.full.json` relative to the workspace again.

## Design
The step keeps reading `ship-gate.config.json` from the working directory and writes `$RUNNER_TEMP/ship-gate.full.json`. The `config` input uses `${{ runner.temp }}/ship-gate.full.json`. Ships as patch v3.14.1; sites replace `full-sweep.yml` and bump the pin.

## Areas of concern
Sites that still have v3.14.0's `full-sweep.yml` stay red on `conform:check` until they take v3.14.1 (web-baseline rolls it out).

## Out of scope
Site dependency advisories (`audit:deps`), fixed in each site repo.
