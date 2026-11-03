# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and the rest) working in this repository, and for the people running them. Claude Code reads `CLAUDE.md`, which only imports this file and `CONTRIBUTING.md`.

## Read first, in full

Before you read or change any code, read these files completely. Do not work from memory, from this summary or from a search hit.

1. [README.md](README.md): what the app does, how it fits together, and the numbers still to verify.
2. [CONTRIBUTING.md](CONTRIBUTING.md): set-up, checks, branches, the safety and privacy rules, and the policy on AI agents.
3. [docs/spec.md](docs/spec.md): the acceptance criteria every change must keep.

Start your first reply by naming the files you have read. If you have not read them in this session, stop and read them now. When a file contradicts this one, say so and ask; do not pick.

The person running you is responsible for everything you produce, and has to understand it (see *AI and automated agents* in CONTRIBUTING). Explain your changes so they can follow them, and say plainly what you are unsure of or could not check. The limits in that section apply to you in full: no merging, deploying, destructive commands or secrets unless asked in this session, and no real athlete's data in anything you write.

## This repository

- **The safety rules are the product.** Planned carbs never pass the gut figure, and planned fluid never passes the sweat rate, on any leg, for any product. Finish times are always a range that adds up. Never weaken these or their tests in `tests/fuel.test.js` and `tests/pace.test.js`. A change to the maths adds a test.
- **Numbers live in one place.** Every pacing and fuelling range sits at the top of `public/js/pace.js` or `public/js/fuel.js`, marked `UNCHECKED` until it is verified. Never put a number in a screen. Never mark one checked unless the owner checked it against a named source.
- **Nothing leaves the phone.** No server, no account, no analytics, no network call. `public/_headers` enforces this with `connect-src 'none'`. Don't loosen it without the owner's agreement in this session.
- **A blank is not zero.** `null >= 0` is true in JavaScript. Check a value is a finite number before comparing it (see `isNum` in `fuel.js`). This bug reached review twice on 3 November 2026.
- **Don't edit the tree while a reviewer or verifier agent is running on it.** Let it finish, or pin it to a commit. On 3 November 2026 a verifier reported a fixed bug as current because the files changed under it.
