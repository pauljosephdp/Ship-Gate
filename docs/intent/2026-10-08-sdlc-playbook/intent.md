# Intent: adopt the AI-Native SDLC Playbook in Ship Gate and its sites
Author: Paul Joseph (owner), with Claude. Date: 2026-10-08. Status: accepted.

## Problem
Ship Gate follows some of the playbook's principles, but few of its named artifacts and controls exist:
- **Change records:** there is no intent, spec or plan per change.
- **Review:** there is no `REVIEW.md`, and no Claude review in CI.
- **Guardrails:** there are no hooks and no `CODEOWNERS`.
- **CI:** there are no agent evals, no Claude triage of failed builds, and no monitoring that catches slow drift. Playway's `verify` crept to 28–30 minutes and timed out three times before anyone acted.

## Proposed outcome
- Ship Gate itself works the playbook way.
- All eight sites move to the latest Ship Gate in one PR each.

The sites already follow the playbook through web-baseline 6.1.1. This was found during the build; see `spec.md`, Areas of concern.

## Affected users and systems
- Ship Gate: `CLAUDE.md`, workflows and templates.
- The eight site repos: Cocoon, LowLightKing, Playway, QualifiedDeals, PaulJoseph, Gallivant, FrametoFunnel and MinuJoseph.

## Constraints
- Everything runs in the cloud: GitHub Actions and Workers Builds.
- Nothing in CI writes to production.
- Only the release job tags.
- No test is weakened.
- Claude in CI uses the repo's `ANTHROPIC_API_KEY` secret, which the owner adds.

## Open questions
- Rollback rehearsal: the playbook rehearses rollback in staging. The sites have no staging environment, and their policy keeps Cloudflare tokens out of workflows. See spec.md.
