# Security policy

Tranchant runs on developers' machines, next to their source code, hands the
text of a code review to Claude Code agents that can edit files, and posts
comments on merge requests under the user's account. We take
reports about it seriously.

## Supported versions

Only the latest release is supported: fixes ship as a new version. Update with
`claude plugin marketplace update tranchant` before reporting.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/annotant/tranchant/security/advisories/new).

Include what you can of:

- the affected component (see [Scope](#scope)) and commit;
- the steps or a proof of concept that reproduces it;
- the impact you expect: what an attacker can read, run or change, and from where.

What happens next:

1. We acknowledge the report within **7 days**.
2. We confirm or rule out the issue, and share our assessment and a fix plan,
   within **30 days**.
3. We fix it in a private fork, publish the fix and a
   [security advisory](https://github.com/annotant/tranchant/security/advisories),
   and credit you unless you prefer otherwise.

We ask you to keep the issue private until the advisory is published, and at
most **90 days** after your report.

## Scope

In scope, in this repository:

- **The local server** (`skills/tranchant/scripts/server.mjs`): it must only
  listen on `127.0.0.1` and only answer requests from its own origin. Reaching
  it from another origin or another machine (DNS rebinding included), or
  reading or writing files through it, is a vulnerability.
- **The page** (`skills/tranchant/page/`): it must not run script taken from a
  review file, a finding, a diff or an agent's notes (a diagram's SVG is
  sanitized before it is shown).
- **The hooks and file locks** (`hooks/register.ts`,
  `skills/tranchant/scripts/hook.mjs`): bypassing a lock, or making a hook run
  a command it should not.
- **Prompt injection**: a finding's text, a reviewer's context, an answer, the
  reviewed diff or code making an agent act outside the finding's intent or
  outside the project.
- **Posting** (`skills/tranchant/scripts/post.mjs`): a comment posted somewhere
  other than the review's merge request, or other text than the one the user
  settled.
- **This repository's supply chain**: its dependencies, the page bundle
  published on the `stable` branch, and its GitHub Actions workflows.

Out of scope:

- Vulnerabilities in Claude Code itself: report them to Anthropic
  ([responsible disclosure](https://www.anthropic.com/responsible-disclosure-policy)).
- Vulnerabilities in the code a user reviews with Tranchant.
- Attacks that need an attacker to already run code as the user on their machine.
