# Intent, spec and plan

Each change starts here, in its own folder, `YYYY-MM-DD-short-name/`. This is the same layout the web-baseline sites use. It follows the AI-native SDLC:
- Each stage commits one artifact.
- The next stage starts by reading it.
- Together the files are the audit trail of who asked for what, what was decided, and how it was built.

| File | Stage | Written by | Accepted by |
|---|---|---|---|
| `intent.md` | Plan | The person with the idea, with Claude, in their own words | The product owner, by merging it |
| `spec.md` | Design | Claude, from the accepted `intent.md` | The product owner. Flagged concerns go to their owner first |
| `plan.md` | Build | Claude in plan mode, from `spec.md`; the engineer corrects it | The engineer. Higher-risk changes go to a tech lead |

**Rules for the files:**
- Copy the files from `_template/`.
- A small change may skip `spec.md`, but never `plan.md`.
- When the build departs from the plan, update `plan.md` in the same commit.
- The pull request links the folder, and review checks the diff against `plan.md` (`REVIEW.md`, compliance pass).
- A CI health finding (`.github/workflows/ci-health.yml`) arrives as an issue in `intent.md` form. Accepting it means committing it here.
