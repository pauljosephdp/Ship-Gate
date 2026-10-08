#!/usr/bin/env bash
# Ship Gate hook (PostToolUse, Edit|Write|MultiEdit): ShellCheck the shell script that just
# changed, so an error is fixed in the same step instead of in CI. Fast and scoped to one file;
# the full checks run before a task is reported done (CLAUDE.md) and in CI.
# Exit 2 sends the findings back to Claude. No ShellCheck installed: nothing to do.
set -uo pipefail
path="$(jq -r '.tool_input.file_path // ""' 2>/dev/null)" || exit 0
case "$path" in *.sh) ;; *) exit 0 ;; esac
[ -f "$path" ] && command -v shellcheck >/dev/null 2>&1 || exit 0
if ! out="$(shellcheck -S error "$path" 2>&1)"; then
  printf 'ShellCheck found errors in %s:\n%s\n' "$path" "$out" >&2
  exit 2
fi
exit 0
