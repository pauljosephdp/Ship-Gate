#!/usr/bin/env bash
# Ship Gate hook (PreToolUse, Edit|Write|MultiEdit): an agent fixing code must not weaken the
# check on that code. Changing an EXISTING test file (the globs in .claude/protected-tests.txt,
# one per line) asks a person first; adding a new test needs no approval.
# Prints a PreToolUse "ask" decision as JSON; exit 0 otherwise.
set -uo pipefail
path="$(jq -r '.tool_input.file_path // ""' 2>/dev/null)" || exit 0
[ -n "$path" ] && [ -f "$path" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
list="$root/.claude/protected-tests.txt"
[ -f "$list" ] || exit 0
rel="${path#"$root"/}"
shopt -s globstar extglob
while IFS= read -r glob; do
  glob="${glob%%#*}"; glob="$(xargs <<<"$glob")"; [ -n "$glob" ] || continue
  # In [[ ]], * already crosses "/", so "**/x" must also match x at the root.
  # shellcheck disable=SC2053 # $glob is a pattern on purpose
  if [[ $rel == $glob || ( $glob == '**/'* && $rel == ${glob#'**/'} ) ]]; then
    jq -n --arg r "$rel is a protected test (.claude/protected-tests.txt). Changing an existing test needs a person's approval: fix the code, not the test." \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
    exit 0
  fi
done < "$list"
exit 0
