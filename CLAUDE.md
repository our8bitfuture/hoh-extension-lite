# Project instructions

## Git

- Commit as the `our8bitfuture` GitHub account for all commits and PRs. Use
  the GitHub no-reply address, never a personal one:

      git config user.name "Our 8-bit Future"
      git config user.email "291346298+our8bitfuture@users.noreply.github.com"

  Verify both are set in every new worktree before committing.
- Keep commit messages and PR bodies clean: a subject line and a body that
  explains the change, and nothing after it. No trailers, no footers.
- This repo is public. Nothing in it — code, comments, docs, commit metadata —
  may carry a real name, personal email, or account handle other than
  `our8bitfuture`.

## Scope

Barebones on purpose: a popup with two buttons (copy token, open the API
console) and a small console behind it. New features belong somewhere else —
keep the permission list and the review surface small.
