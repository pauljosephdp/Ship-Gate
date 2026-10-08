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

# Messages are text, not commands: drop heredoc bodies and the values of -m/--message/--body/
# --title/--notes before looking. Then split at ; && || | newlines, $( ` ( ) { } and check every
# piece wherever git, gh or wrangler appears in it, so prefixes (timeout, env, then, npx -y,
# cd x &&) and global options (git -C, --no-pager) don't hide a command.
strip_messages() {
  awk '
    hd != "" { if ($0 ~ "^[[:space:]]*" hd "[[:space:]]*\\)?[[:space:]]*$") hd = ""; next }
    { line = $0
      if (match(line, /<<-?[[:space:]]*["\047]?[A-Za-z_][A-Za-z0-9_]*["\047]?/)) {
        tag = substr(line, RSTART, RLENGTH); gsub(/<<-?[[:space:]]*|["\047]/, "", tag); hd = tag
        line = substr(line, 1, RSTART - 1) }
      print line }' |
  sed -E "s/(^|[[:space:]])(-m|--message|--body|--title|--notes|-t)([[:space:]]+|=)(\"([^\"\\\\]|\\\\.)*\"|'[^']*'|[^[:space:]]+)/\1/g"
}
check() { # $1: one piece of the command
  local seg="$1" push args w branch
  # Searching or printing text runs nothing.
  [[ $seg =~ ^[[:space:]]*(grep|egrep|rg|ag|cat|less|head|tail|wc)([[:space:]]|$) ]] && return 0
  if [[ ! $seg =~ git([[:space:]]+[^[:space:]]+)*[[:space:]]+stash[[:space:]]+push ]] && [[ $seg =~ (^|[^[:alnum:]_./-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]|$) ]]; then
    push="$(sed -E 's/.*[[:space:]]push([[:space:]]|$)//; s/[0-9]*[<>]+&?[^[:space:]]*//g' <<<"$seg" | tr -d "\"'(){}\`")"
    grep -qE -- '--no-verify' <<<"$push" && block "git push --no-verify skips the repository's checks."
    grep -qE -- '(^|[[:space:]])(--force|-f)([[:space:]]|$)|(^|[[:space:]])\+[^[:space:]]' <<<"$push" \
      && block "force-push rewrites history. Use --force-with-lease on your own branch, never on main."
    grep -qE -- '(^|[[:space:]:+])(refs/heads/)?(main|master)([[:space:]]|$)' <<<"$push" \
      && block "pushing to main or master. Push a branch and open a pull request; main changes only through a merged PR."
    grep -qE -- '(^|[[:space:]])--(tags|follow-tags|mirror|all)([[:space:]]|$)|refs/tags/|(^|[[:space:]:])v[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$)' <<<"$push" \
      && block "pushing tags. Only the release job tags, and only green commits on main."
    # No destination of its own ("git push", "git push origin", "git push origin HEAD"): git
    # pushes the current branch, so check which branch that is.
    read -ra words <<<"$push"
    args=(); for w in "${words[@]}"; do case "$w" in -*) ;; *) args+=("$w") ;; esac; done
    if [ "${#args[@]}" -le 1 ] || { [ "${#args[@]}" -eq 2 ] && [ "${args[1]}" = HEAD ]; }; then
      branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"
      case "$branch" in main|master) block "you are on $branch; this git push would push to it. Work on a branch and open a pull request." ;; esac
    fi
  fi
  if [[ $seg =~ (^|[^[:alnum:]_./-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$) ]]; then
    grep -qE -- '(^|[[:space:]])(--no-verify|-[a-zA-Z]*n[a-zA-Z]*)([[:space:]]|$)' <<<"${seg#*commit}" \
      && block "git commit --no-verify skips the repository's checks."
  fi
  if [[ $seg =~ (^|[^[:alnum:]_./-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+tag([[:space:]]|$) ]]; then
    w="$(sed -E 's/.*[[:space:]]tag([[:space:]]|$)/tag /; s/[)}]+[[:space:]]*$//' <<<"$seg")"
    grep -qE '^tag[[:space:]]*$|^tag[[:space:]]+(-l|--list|-n[0-9]*|--contains|--points-at|--merged|--no-merged|-v|--verify|--sort(=[^[:space:]]*)?|--format(=[^[:space:]]*)?|--column)([[:space:]]|$)' <<<"$w" \
      || block "creating or moving a tag. Only the release job tags, and only green commits on main."
  fi
  grep -qE '(^|[^[:alnum:]_./-])gh[[:space:]]+release[[:space:]]+(create|delete|edit|upload)' <<<"$seg" \
    && block "publishing or editing a GitHub release. The release job publishes it when the merge lands on main."
  grep -qE '(^|[^[:alnum:]_./-])gh[[:space:]]+pr[[:space:]]+merge([[:space:]].*)?[[:space:]]--admin' <<<"$seg" \
    && block "gh pr merge --admin bypasses the required checks."
  local wr='wrangler(@[^[:space:]]+)?([[:space:]]+-[^[:space:]]*)*[[:space:]]+'
  if grep -qE "(^|[^[:alnum:]_.-])$wr" <<<"$seg"; then
    grep -qE "$wr(deploy|publish|rollback|delete)([[:space:]]|$)" <<<"$seg" \
      && block "wrangler deploy, rollback and delete change production. Cloudflare Workers Builds deploys main; a rollback is a person's call in the dashboard."
    grep -qE "$wr(versions[[:space:]]+(deploy|upload)|pages[[:space:]]+deploy|triggers[[:space:]]+deploy)" <<<"$seg" \
      && block "this wrangler command changes production. Workers Builds deploys main."
    grep -qE "${wr}secret[[:space:]]+(put|delete|bulk)" <<<"$seg" && block "Worker secrets are set by a person in the dashboard, never by an agent."
    grep -qE "${wr}d1[[:space:]].*--remote" <<<"$seg" && block "a remote D1 command writes to or reads production data. Use --local."
    grep -qE "$wr(r2[[:space:]]+object|kv[[:space:]]+(key|bulk))[[:space:]]+(put|delete)" <<<"$seg" && block "R2 and KV writes change production data."
    grep -qE "$wr(r2[[:space:]]+bucket|kv[[:space:]]+namespace|d1|queues|vectorize|hyperdrive)[[:space:]]+(create|delete|update)" <<<"$seg" \
      && block "creating, changing or deleting a Cloudflare resource is a person's call in the dashboard."
  fi
  return 0
}

while IFS= read -r seg; do
  [ -n "${seg//[[:space:]]/}" ] && check "$seg"
done < <(strip_messages <<<"$cmd" | sed -E 's/(&&|\|\||;|\||&|\$\(|`|\(|\)|\{|\})/\n/g')
exit 0
