# Review instructions

Read by the Claude review (`.github/workflows/claude.yml`) on every pull request that is ready for review. The findings inform the code owner, who approves; the review neither approves nor blocks a PR on its own. Ship Gate's `verify` already checks structure, discovery, accessibility, CSP, reflow and Lighthouse, so don't repeat what it enforces.

## Passes
Run three passes, and tag each finding with the pass it came from.
- **Bugs:** broken links and routes, logic errors in components, Workers and scripts, and regressions in forms, consent or analytics.
- **Security:**
  - secrets or keys in code or config;
  - Turnstile and form handling without server-side verification;
  - user input reaching HTML unescaped;
  - anything that writes to production (wrangler deploy, secrets, remote D1, R2 or KV writes).
- **Compliance:** the diff matches the change's `docs/changes/*/plan.md` and `spec.md` when it has them, and follows `CLAUDE.md`, this site's brand guide and its Ship Gate policies.

## What Important means here
Reserve **Important** for findings that would:
- break a page or a form;
- leak data;
- track a visitor before consent;
- write to production;
- breach a policy in `CLAUDE.md` or the brand guide.

Copy tone and naming are nits.

## Cap the nits
Report at most five nits per review, and give the rest as a count.

## Do not report
- Generated files (`dist/`, `.astro/`, lockfiles).
- Anything Ship Gate's `verify` already enforces.
