# Intent: one rule file, zero overlap with website-audit (Ship Gate v4)
Author: Paul (owner), with Claude. Date: 2026-11-14. Status: accepted.

## Problem
Ship Gate (the merge gate: build output, the build served on localhost, and a post-deploy check) and the
website-audit skill (`pauljosephdp/Skills`, `website-audit/`, the live-site auditor) run about 20 of the same
checks with different rules: two crawler lists, two China host lists, two tracker lists, two JSON-LD
required-property tables, two llms.txt readings, and post-deploy checks that re-test live behaviour
website-audit already audits (field Core Web Vitals from CrUX, Zaraz, ETag/Last-Modified, Markdown
negotiation, live Link headers, live crawler rules). A site can pass one and fail the other on the same fact.
Several build-provable checks live only in website-audit (bulk-stamped sitemap `lastmod`, no-JS content ratio,
`<img>` without dimensions, lazy-loaded first-viewport images, desktop/mobile parity, visible FAQ without
markup, orphans and click depth), so a site learns about them after it ships.

## Proposed outcome
Zero overlap. Each check has one owner and one implementation:
- Anything provable from the build, or the build served on localhost, belongs to Ship Gate.
- Anything that needs production, the edge, field data or Search Console belongs to website-audit.
- Both read one rule file, `standards/standards.json`, owned here. website-audit carries a generated copy.
- website-audit stops re-testing build-provable checks and reads Ship Gate's results instead, so every gate
  run writes `reports/results.json` and the monthly full sweep uploads it as the `ship-gate-results` artifact.

## Affected users and systems
`action.yml`, `post-deploy/`, `scripts/` (discovery, market, prepare, guards, live checks), `e2e/`,
`templates/caller/` (full sweep, post-deploy), every site through web-baseline's Ship Gate pin, and
website-audit (a later change in `pauljosephdp/Skills`, out of this repo).

## Constraints
- Removing checks that callers rely on is a major release: v4.0.0, with a migration note.
- No check is weakened without moving to its new owner; nothing is deleted silently.
- `standards.json` keeps the contract draft's schema and values and invents no sources.
- Protected tests (`.claude/protected-tests.txt`) are not edited without a person: new checks get new tests.
- Nothing in the gate writes to production; this session commits locally and does not push.

## Open questions
Answered by Paul through the coordinating session:
- Delegation key: a site declares `"standard": "web-baseline"`.
- Training tokens: keep today's semantics (block by default, `reserve` and `allow` stay).
- `ai-search-crawlers`: `groups.searchMustAllow` plus `userFetchShouldAllow`, as today.
