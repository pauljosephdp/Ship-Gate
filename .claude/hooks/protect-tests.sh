#!/usr/bin/env bash
# Ship Gate hook (PreToolUse, Edit|Write|MultiEdit): an agent fixing code must not weaken the
# check on that code. Changing an EXISTING test file (the globs in .claude/protected-tests.txt,
# one per line) asks a person first; adding a new test needs no approval.
# Prints a PreToolUse "ask" decision as JSON; exit 0 otherwise.
# Also runs on Bash: a command that writes in place (sed -i, perl -i, a redirect, tee, rm, mv,
# cp, truncate, git checkout/restore) and names an existing protected test asks the same way.
set -uo pipefail
input="$(cat)"
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
list="$root/.claude/protected-tests.txt"
[ -f "$list" ] || exit 0
shopt -s globstar extglob
protected() { # $1: a path relative to the repo root
  local glob
  while IFS= read -r glob; do
    glob="${glob%%#*}"; glob="$(xargs <<<"$glob")"; [ -n "$glob" ] || continue
    # In [[ ]], * already crosses "/", so "**/x" must also match x at the root.
    # shellcheck disable=SC2053 # $glob is a pattern on purpose
    [[ $1 == $glob || ( $glob == '**/'* && $1 == ${glob#'**/'} ) ]] && return 0
  done < "$list"
  return 1
}
ask() {
  jq -n --arg r "$1 is a protected test (.claude/protected-tests.txt). Changing an existing test needs a person's approval: fix the code, not the test." \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}
cmd="$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)"
if [ -n "$cmd" ]; then
  # Redirects that only move a stream (2>&1, >/dev/null) write no file.
  writes="$(sed -E 's/[0-9]*>&[0-9-]+//g; s#[0-9]*>>?[[:space:]]*/dev/null##g' <<<"$cmd")"
  grep -qE '(sed|perl)[[:space:]]+(-[a-zA-Z]*i|--in-place)|>|(^|[;&|[:space:]])(tee|rm|mv|cp|truncate)[[:space:]]|git[[:space:]]+(checkout|restore)[[:space:]]' <<<"$writes" || exit 0
  for w in $cmd; do
    w="${w#\"}"; w="${w%\"}"; w="${w#\'}"; w="${w%\'}"; w="${w#>}"; w="${w#"$root"/}"; w="${w#./}"
    [ -n "$w" ] && [ -f "$root/$w" ] && protected "$w" && ask "$w"
  done
  exit 0
fi
path="$(jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null)"
[ -n "$path" ] && [ -f "$path" ] || exit 0
rel="${path#"$root"/}"
protected "$rel" && ask "$rel"
exit 0
