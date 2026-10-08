#!/usr/bin/env bash
# Ship Gate hook (PreToolUse, Bash): the approval gates that must hold in every Claude Code
# session, whoever runs it. Blocks, with the reason and the route to approval:
#   - pushing to main or master, force-pushing, and skipping git hooks (--no-verify):
#     every change reaches main through a pull request and its required checks;
#   - creating, pushing or publishing tags and releases: only Ship Gate's release job
#     tags, and only green commits;
#   - wrangler commands that deploy, roll back or write to production (deploy, rollback,
#     secrets, remote D1, R2 and KV writes, and creating or deleting buckets, namespaces and
#     databases): Cloudflare Workers Builds deploys main, and
#     production changes are made by a person in the dashboard.
# Exit 2 blocks the command; the message on stderr goes to Claude. Reads the hook JSON on stdin.
set -uo pipefail
cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null)" || exit 0
[ -n "$cmd" ] || exit 0
block() { printf 'Blocked by .claude/hooks/guard-bash.sh: %s\n' "$1" >&2; exit 2; }

# Check each command on its own: split at ; && || | and newlines, so a second command chained
# after a harmless one is still seen. A segment is judged by the command it runs, not by text in
# its arguments, so a commit message or PR body that mentions "git push origin main" passes.
check() { # $1: one command segment
  local seg="$1" push args w branch
  seg="$(sed -E 's/^[[:space:]]*(\(|\{)?[[:space:]]*//; s/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*//; s/^(sudo|command|exec|time)[[:space:]]+//' <<<"$seg")"
  case "$seg" in
    git[[:space:]]*)
      # git [-C dir] [-c k=v] <subcommand> ...
      local rest; rest="$(sed -E 's/^git([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+)*[[:space:]]+//' <<<"$seg")"
      case "$rest" in
        push|push[[:space:]]*)
          push="$(tr -d "\"'" <<<"${rest#push}")"
          grep -qE -- '--no-verify' <<<"$push" && block "git push --no-verify skips the repository's checks."
          grep -qE -- '(^|[[:space:]])(--force|-f)([[:space:]]|$)|(^|[[:space:]])\+[^[:space:]]' <<<"$push" \
            && block "force-push rewrites history. Use --force-with-lease on your own branch, never on main."
          grep -qE -- '(^|[[:space:]:+])(refs/heads/)?(main|master)([[:space:]]|$)' <<<"$push" \
            && block "pushing to main or master. Push a branch and open a pull request; main changes only through a merged PR."
          grep -qE -- '(^|[[:space:]])--(tags|follow-tags|mirror)([[:space:]]|$)|refs/tags/|(^|[[:space:]:])v[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$)' <<<"$push" \
            && block "pushing tags. Only the release job tags, and only green commits on main."
          # No destination of its own ("git push", "git push origin", "git push origin HEAD"): git
          # pushes the current branch, so check which branch that is.
          read -ra words <<<"$push"
          args=(); for w in "${words[@]}"; do case "$w" in -*) ;; *) args+=("$w") ;; esac; done
          if [ "${#args[@]}" -le 1 ] || { [ "${#args[@]}" -eq 2 ] && [ "${args[1]}" = HEAD ]; }; then
            branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"
            case "$branch" in main|master) block "you are on $branch; this git push would push to it. Work on a branch and open a pull request." ;; esac
          fi ;;
        commit[[:space:]]*)
          grep -qE -- '(^|[[:space:]])(--no-verify|-n)([[:space:]]|$)' <<<"$(sed -E "s/(-m|--message)[[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:]]+)//g" <<<"$rest")" \
            && block "git commit --no-verify skips the repository's checks." ;;
        tag|tag[[:space:]]*)
          grep -qE '^tag[[:space:]]*$|^tag[[:space:]]+(-l|--list|-n[0-9]*|--contains|--points-at|--merged|--no-merged|-v|--verify)([[:space:]]|$)' <<<"$rest" \
            || block "creating or moving a tag. Only the release job tags, and only green commits on main." ;;
      esac ;;
    gh[[:space:]]*)
      grep -qE '^gh[[:space:]]+release[[:space:]]+(create|delete|edit|upload)' <<<"$seg" \
        && block "publishing or editing a GitHub release. The release job publishes it when the merge lands on main."
      grep -qE '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]].*)?[[:space:]]--admin' <<<"$seg" \
        && block "gh pr merge --admin bypasses the required checks." ;;
  esac
  seg="$(sed -E 's/^(npx|pnpm|yarn|bunx)[[:space:]]+(exec[[:space:]]+)?//; s#^[^[:space:]]*/##' <<<"$seg")"
  case "$seg" in
    wrangler[[:space:]]*)
      grep -qE '^wrangler[[:space:]]+(deploy|publish|rollback|delete)([[:space:]]|$)' <<<"$seg" \
        && block "wrangler deploy, rollback and delete change production. Cloudflare Workers Builds deploys main; a rollback is a person's call in the dashboard."
      grep -qE '^wrangler[[:space:]]+(versions[[:space:]]+(deploy|upload)|pages[[:space:]]+deploy|triggers[[:space:]]+deploy)' <<<"$seg" \
        && block "this wrangler command changes production. Workers Builds deploys main."
      grep -qE '^wrangler[[:space:]]+secret[[:space:]]+(put|delete|bulk)' <<<"$seg" && block "Worker secrets are set by a person in the dashboard, never by an agent."
      grep -qE '^wrangler[[:space:]]+d1[[:space:]].*--remote' <<<"$seg" && block "a remote D1 command writes to or reads production data. Use --local."
      grep -qE '^wrangler[[:space:]]+(r2[[:space:]]+object|kv[[:space:]]+(key|bulk))[[:space:]]+(put|delete)' <<<"$seg" && block "R2 and KV writes change production data."
      grep -qE '^wrangler[[:space:]]+(r2[[:space:]]+bucket|kv[[:space:]]+namespace|d1|queues|vectorize|hyperdrive)[[:space:]]+(create|delete|update)' <<<"$seg" \
        && block "creating, changing or deleting a Cloudflare resource is a person's call in the dashboard." ;;
  esac
  return 0
}

while IFS= read -r seg; do
  [ -n "${seg//[[:space:]]/}" ] && check "$seg"
done < <(sed -E 's/(&&|\|\||;|\|)/\n/g' <<<"$cmd")
exit 0
