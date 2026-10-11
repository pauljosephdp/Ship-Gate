# Intent: axe waits for late scroll-driven transitions
Author: Claude (for Paul Joseph, owner). Date: 2026-10-11. Status: accepted (Paul, 11 October 2026: "Fix Ship-Gate").

## Problem
`verify` failed on pauljosephdp/Gallivant#39 with axe `color-contrast` on the home page's `a[href$="#people"]`, a change
that only touched a unit test. `settle()` scrolls to the end and back to 0, then checks `document.getAnimations()`
straight away. The site's header hides at the top of the home page with an opacity transition that its ScrollTrigger
starts a frame or more after the scroll, so the check finds nothing running and axe samples the link mid-fade (grey
#a6a6a6–#dfdfdf on Stone, 1.3 to 3.4:1). Reproduced 5 of 5 runs on that branch and on a build before the site's recent
changes, with the same scroll-then-axe sequence at 1440 × 900; #37 and #38 passed the same check, so it is a timing race.

## Proposed outcome
axe scans the page once scroll-driven state has finished changing; a site does not go red because a transition started
a frame after the scroll.

## Affected users and systems
`e2e/helpers.ts` `settle()` (used before axe, reflow and the zoom check) on every site; the caller templates' pins.

## Constraints
A patch release: no conforming site may fail. `settle()` keeps its 3 s ceiling.

## Open questions
None.
