#!/usr/bin/env bash
# Ship Gate hook (PreToolUse, Bash): the approval gates that must hold in every Claude Code
# session, whoever runs it. Blocks, with the reason and the route to approval:
#   - pushing to main or master, force-pushing, and skipping git hooks (--no-verify):
#     every change reaches main through a pull request and its required checks;
#   - creating, pushing or publishing tags and releases: only Ship Gate's release job
#     tags, and only green commits;
#   - wrangler commands that deploy, roll back or write to production (deploy, rollback,
#     secrets, remote D1, R2 and KV writes): Cloudflare Workers Builds deploys main, and
#     production changes are made by a person in the dashboard.
# Exit 2 blocks the command; the message on stderr goes to Claude. Reads the hook JSON on stdin.
set -uo pipefail
cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0
block() { printf 'Blocked by .claude/hooks/guard-bash.sh: %s\n' "$1" >&2; exit 2; }
has() { grep -qE -- "$1" <<<"$cmd"; }

if has '(^|[;&|[:space:]])git[[:space:]]+([^;&|]*[[:space:]])?push([[:space:]]|$)'; then
  push="$(grep -oE 'git[[:space:]]+([^;&|]*[[:space:]])?push([^;&|]*)' <<<"$cmd" | head -1)"
  grep -qE -- '--no-verify' <<<"$push" && block "git push --no-verify skips the repository's checks."
  grep -qE -- '(^|[[:space:]])(--force|-f)([[:space:]]|$)' <<<"$push" \
    && block "force-push rewrites history. Use --force-with-lease on your own branch, never on main."
  grep -qE -- '(^|[[:space:]:+])(refs/heads/)?(main|master)([[:space:]]|$)' <<<"$push" \
    && block "pushing to main or master. Push a branch and open a pull request; main changes only through a merged PR."
  grep -qE -- '(^|[[:space:]])--(tags|follow-tags|mirror)([[:space:]]|$)|refs/tags/|(^|[[:space:]:])v[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$)' <<<"$push" \
    && block "pushing tags. Only the release job tags, and only green commits on main."
  # A bare "git push" (no refspec) pushes the current branch.
  if ! grep -qE 'push[[:space:]]+([^-[:space:]][^[:space:]]*[[:space:]]+)?[^-[:space:]]' <<<"$push"; then
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    case "$branch" in main|master) block "you are on $branch; a bare git push would push to it. Work on a branch and open a pull request." ;; esac
  fi
fi
has '(^|[;&|[:space:]])git[[:space:]]+([^;&|]*[[:space:]])?commit[^;&|]*--no-verify' && block "git commit --no-verify skips the repository's checks."
if has '(^|[;&|[:space:]])git[[:space:]]+tag([[:space:]]|$)' \
  && ! has 'git[[:space:]]+tag([[:space:]]*($|[;&|])|[[:space:]]+(-l|--list|-n[0-9]*|--contains|--points-at|--merged|--no-merged|-v|--verify)([[:space:]]|$))'; then
  block "creating or moving a tag. Only the release job tags, and only green commits on main."
fi
has '(^|[;&|[:space:]])gh[[:space:]]+release[[:space:]]+(create|delete|edit|upload)' \
  && block "publishing or editing a GitHub release. The release job publishes it when the merge lands on main."
has '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge[^;&|]*--admin' \
  && block "gh pr merge --admin bypasses the required checks."
if has '(^|[;&|[:space:]/])wrangler([[:space:]]|$)'; then
  has 'wrangler[[:space:]]+(deploy|publish|rollback|delete)([[:space:]]|$)' \
    && block "wrangler deploy, rollback and delete change production. Cloudflare Workers Builds deploys main; a rollback is a person's call in the dashboard."
  has 'wrangler[[:space:]]+versions[[:space:]]+(deploy|upload)' && block "wrangler versions deploy/upload changes production. Workers Builds deploys main."
  has 'wrangler[[:space:]]+secret[[:space:]]+(put|delete|bulk)' && block "Worker secrets are set by a person in the dashboard, never by an agent."
  has 'wrangler[[:space:]]+d1[[:space:]][^;&|]*--remote' && block "a remote D1 command writes to or reads production data. Use --local."
  has 'wrangler[[:space:]]+(r2[[:space:]]+object|kv[[:space:]]+(key|bulk))[[:space:]]+(put|delete)' && block "R2 and KV writes change production data."
fi
exit 0
