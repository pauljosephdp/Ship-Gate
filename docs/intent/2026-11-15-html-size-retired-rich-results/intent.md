# Intent: fail a page Googlebot cuts at 2 MB; retire ClaimReview and the Sitelinks search box

Author: Claude
Source: Skills `docs/intent/2026-11-15-self-healing-fleet/ai-readiness-gaps.md` (gaps 5 and 7, Skills #220), Step 5 of
that fleet's plan; facts re-read from the primary sources on 15 Nov 2026
Status: accepted
Accepted-by: Paul, 15 Nov 2026 (self-healing fleet plan approval and "start step 5")

## Problem

- Googlebot fetches up to 2 MB of an HTML URL, HTTP response headers included, and silently drops the rest (Google
  Search Central, "Inside Googlebot", 31 Mar 2026, updated 29 Oct 2026). Nothing in the gate checks a built page's size,
  so a page whose title, canonical, meta robots or JSON-LD sit past the cut ships with them invisible to Google.
- `retiredRichResults` leaves out ClaimReview, which Google phased out of Search results (12 Jun 2025) and removed from
  Search Console reporting on 9 Sep 2025, and the Sitelinks search box.

## Proposed outcome

- New discovery rule `html-size` (SEO, error): a built indexable page over `buildChecks.htmlSize.maxBytes` (2,097,152
  bytes less 16 KiB of headroom for the response headers) fails, and the message names the head elements past the cut.
- `retiredRichResults` gains ClaimReview (2025-09-09, sourced) and the Sitelinks search box ("unverified date", like
  HowTo, because its primary source was not re-read).

## Affected users and systems

Sites with a page over 2 MB: none of the fleet's pages comes close (web-baseline's page-weight budgets are far below).
A conforming site passes, so this is a minor.

## Constraints

- Only facts re-read from the primary source on 15 Nov 2026 gate anything; an unconfirmed date is recorded as
  unverified, never as a rule.

## Open questions

- The Sitelinks search box removal date (believed Nov 2024) needs Google's own post before it is filled in.

## Not in this change

- Bing `ai-training` / `ai-grounding` page controls and the NoArchive/NoCache date (gap 3) and the training opt-out dates
  (gap 4): the primary sources could not be confirmed on 15 Nov (the Bing page did not render; no vendor dates found),
  so nothing gating is added on them yet.
- The back-button-hijacking browser test (gap 6): its own PR, with a fixture variant that proves it.
