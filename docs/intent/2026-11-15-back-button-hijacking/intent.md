# Intent: back button hijacking fails the gate
Author: Claude (session with Paul). Date: 2026-11-15. Status: accepted.

## Problem
Google added back button hijacking to its spam policies (malicious practices) on 13 Apr 2026, enforced from 15 Jun 2026
([Google Search Central](https://developers.google.com/search/blog/2026/04/back-button-hijacking)). A page does it by adding
session-history entries the visitor did not ask for (`history.pushState` or a hash change on load), often from
third-party ad or widget code, so Back stays on the page. Nothing in the gate or in website-audit checks for it
(Skills `docs/intent/2026-11-15-self-healing-fleet/ai-readiness-gaps.md`, gap 6).

## Proposed outcome
A page that adds a history entry without a visitor's action fails `verify`, naming the page and the count, before it
deploys. website-audit's T-11 reads the result and checks the live site for third-party code.

## Affected users and systems
Every site that runs the browser suite (`e2e/page.spec.ts`), `reports/results.json` (`browser:history`), the fixture
self-test, website-audit (Skills) T-11.

## Constraints
No exemption: it is a spam policy, and a legitimate page adds entries only on a click. It must not flag
`history.replaceState`, in-page navigation a visitor starts, or Astro's client router on a click.

## Open questions
None.
