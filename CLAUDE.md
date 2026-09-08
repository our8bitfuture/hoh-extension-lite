# Project instructions

## Git

- Commit as the `our8bitfuture` GitHub account for all commits and PRs. Use
  the GitHub no-reply address, never a personal one:

      git config user.name "Our 8-bit Future"
      git config user.email "291346298+our8bitfuture@users.noreply.github.com"

  Verify both are set in every new worktree before committing.
- Do NOT add any co-authoring notes to commit messages or PR bodies. No
  `Co-Authored-By:` trailers, no "Generated with Claude Code" footers, no
  attribution to any agent or tool. Commit messages end with the message body.
- This repo is public. Nothing in it — code, comments, docs, commit metadata —
  may carry a real name, personal email, or account handle other than
  `our8bitfuture`.

## Scope

Barebones on purpose: a popup with two buttons (copy token, open the API
console) and a small console behind it. New features belong somewhere else —
keep the permission list and the review surface small.
