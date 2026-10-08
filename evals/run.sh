#!/usr/bin/env bash
# Agent evals (AI-native SDLC, Test stage): real Ship Gate tasks, each with a deterministic check,
# run against the agent's configuration (CLAUDE.md, REVIEW.md, .claude/). Each eval runs
# `claude -p` in a fresh worktree of HEAD, then its check there; $RESULT holds Claude's answer.
#   evals/run.sh [eval.json ...]     (default: every evals/*.json)
# Fails when the pass rate is below evals/threshold. Needs ANTHROPIC_API_KEY and claude on PATH.
set -uo pipefail
root="$(git rev-parse --show-toplevel)"; cd "$root" || exit 1
files=("$@"); [ ${#files[@]} -gt 0 ] || files=(evals/*.json)
threshold="$(cat evals/threshold)"
work="$(mktemp -d)"; pass=0; total=0; table="| Eval | Result |"$'\n'"|---|---|"
for f in "${files[@]}"; do
  id="$(jq -r .id "$f")"; total=$((total + 1)); wt="$work/$id"
  git worktree add -q --detach "$wt" HEAD
  (
    cd "$wt" || exit 1
    export CLAUDE_PROJECT_DIR="$wt" RESULT="$work/$id.out"
    timeout 900 claude -p "$(jq -r .prompt "$root/$f")" \
      --permission-mode acceptEdits \
      --allowedTools "Read,Edit,Write,Grep,Glob,Bash(bash scripts/self-test.sh),Bash(bash scripts/check-readme.sh:*),Bash(shellcheck:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git tag:*),Bash(gh release:*),Bash(node --test:*)" \
      --output-format text > "$RESULT" 2>&1
    bash -c "$(jq -r .check "$root/$f")"
  ) > "$work/$id.check" 2>&1
  if [ $? -eq 0 ]; then pass=$((pass + 1)); table+=$'\n'"| $id | ✅ pass |"
  else table+=$'\n'"| $id | ❌ fail |"; echo "::group::$id (failed)"; tail -40 "$work/$id.out"; cat "$work/$id.check"; echo "::endgroup::"; fi
  git worktree remove --force "$wt"
done
rate="$(awk -v p="$pass" -v t="$total" 'BEGIN { printf "%.2f", (t ? p / t : 0) }')"
summary="$(printf '## Agent evals: %s of %s passed (%s, threshold %s)\n\n%s\n' "$pass" "$total" "$rate" "$threshold" "$table")"
echo "$summary"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$summary" >> "$GITHUB_STEP_SUMMARY"
awk -v r="$rate" -v t="$threshold" 'BEGIN { exit !(r + 0 >= t + 0) }' || { echo "::error::Agent eval pass rate $rate is below $threshold."; exit 1; }
