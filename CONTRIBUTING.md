# Contributing

Race-day tools is a static web app in `public/`, with no build step. It runs on the athlete's phone. It has one small server function, `functions/api/send.js`, that only emails a race card when the athlete asks. This guide is for people and for AI agents, who must also follow [AGENTS.md](AGENTS.md). [README.md](README.md) explains how it works; [docs/spec.md](docs/spec.md) lists what every change must keep.

The working rules are adapted from the Balance Tri Club maintainer docs (`balancetriclub/docs`), so the club's apps and this suite work the same way. The suite is not a club app. It shares the club apps' look, not their sign-in, data or branding.

## Set up

```sh
git clone https://github.com/jthoyer/race-day-tools.git && cd race-day-tools
npm run serve      # python3 -m http.server 8000 -d public, then open http://localhost:8000
```

There is nothing to install or build. `npm test` needs Node 20 or later. `npm run smoke` needs Playwright with Chromium.

## Before you open a PR

```sh
npm test           # the maths, the safety rules and the store. CI runs this.
npm run smoke      # walks the whole journey in Chromium at phone size. CI does not run this.
```

CI (`.github/workflows/test.yml`) runs `npm test` only, so the smoke test is on you. Run it for any change to `public/`. For a change to a screen, also look at it in a browser at phone width (390 px) and desktop width. Set `SHOTS=some/dir` to save a screenshot of every screen. A change that adds behaviour adds a test.

## Branches and pull requests

Work happens on **short-lived branches cut from an up-to-date `main`**, one branch per piece of work, merged through a pull request with a merge commit. Delete the branch after it merges, and start a new one rather than reusing a merged one.

- Name it `type/short-description`, lowercase with hyphens: `feat/countdown`, `fix/sip-rounding`, `docs/verify-ranges`, `refactor/split-app-js`, `test/fuel-fuzz`, `chore/headers`. Say what, not who or when.
- Use the same type in the PR title. Never commit to `main` directly, never force-push it.
- **Merging to `main` deploys** to https://jthoyer.github.io/race-day-tools/ within a minute or two, once `npm test` passes, so a merge is a release.
- The PR description says what changed and why, anything to do by hand outside the repo, what you ran and what you could not run, and any decision for the reviewer.

## Commits

One logical change per commit, subject in the imperative and about 72 characters or fewer, the body for the **why**. Agents end the message with the attribution trailer their environment gives them (`Co-Authored-By: …`).

## Rules this codebase keeps

- **No `innerHTML` built from a variable.** Anything a person types (race names, product names) goes in as text. `public/js/ui.js` builds every element with text nodes; use it.
- **Don't catch and discard errors** (`catch (e) {}`). Storage may be blocked, so the store catches its errors, warns once and carries on. That is the pattern to follow.
- **No build, no bundler, no framework.** Plain scripts loaded with `<script>` tags. Only `public/` and `functions/` are published; `functions/` holds the one server function, `functions/api/send.js`, and nothing else belongs there. Don't add `import` to a page script or a build step without agreeing it first. (The function is the one ES module: `functions/package.json` marks it, so the tests load it with `import()`.)
- **A vendored file has a pinned version, its licence beside it, and is never edited by hand.** `public/js/vendor/` holds the PDF library as it came from its package. Its licence file records the version, size and SHA-256, and a new version replaces the file whole, with a `?v=` bump on every page that loads it.
- **Bump the `?v=` on a `<script>` or stylesheet tag when its file changes**, in `public/index.html` and both guide pages, so a stale copy can't be served.
- **No secrets in the repo.** The app has none today and should keep it that way.
- **Use made-up data.** Tests, fixtures, screenshots and issues use invented athletes and numbers, never a real person's weight, test results or race times.
- **Match the look.** Copy the tokens in `public/css/app.css` (see *Look* in the README). Don't invent new colours, fonts or components. The app is light only.

## AI and automated agents

AI agents do most of the work here, and that is fine. These rules are about accountability, not about avoiding the tools. They are adapted from the Balance Tri Club maintainer docs, which adapted them from [Ghostty's AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md).

- **You are responsible for what you ship.** Whoever commits or opens the PR owns the change: its correctness, safety, privacy and upkeep, even if an agent wrote every line. "The agent did it" is not an answer when a plan goes wrong on race day.
- **Understand it before you ask for review.** You must be able to explain, without asking the agent, what the change does, why it is needed, how it fits and what could go wrong. If you can't, have the agent explain it until you can, or shrink the change.
- **Verify, don't trust.** Read the whole diff. Run the checks yourself and look at screen changes in a browser. Agents invent function names, settings and figures with total confidence, so check anything you don't recognise. Say in the PR what you ran and what you could not, and never write that something passed when it was not run.
- **Check every training or nutrition figure against a named source.** An agent's "typical range" is a claim to check, not a fact. Until it is checked, it stays marked `UNCHECKED`.
- **Disclose.** Keep the `Co-Authored-By` trailer on agent-written commits, and say in the PR which tool did what (wrote, reviewed, researched) and what you checked by hand. Name any scheduled or unattended agent.
- **Keep a human in the loop.** An agent does not merge, push to `main`, deploy, run a destructive or irreversible command (deleting a branch or history), set or rotate a secret, or change a hosting or DNS setting, unless a person asked for that specific action in this session. It writes the step and hands it over. No agent runs unattended with write access to this repo or to hosting.
- **Keep real people's data out of every prompt.** Never give a model, chat, issue, PR, note or log a real athlete's name, email, weight, test results or race data. Use made-up data (`Sam Lee`, `sam@example.test`).
- **Write in your own words.** An agent may draft issues, PR descriptions, guides and docs, and you edit them. Cut the padding, check every claim, and post nothing you have not read. Guides must be accurate, not merely plausible: people will race on them.
- **No AI-generated images, logos, audio or video** in the app or the guides without the owner's agreement.
- **When AI-written code breaks something,** the author fixes it. If it is a mistake an agent would repeat, add a line to `AGENTS.md`.

### Working with an agent, day to day

- Start in the repo's root, so the agent finds `AGENTS.md`. If it skips the files that file lists, tell it to read them before going on.
- Ask for small changes, one branch each, with a plan first for anything that touches the safety rules or the maths.
- Make it explain: what the change does, what it doesn't cover and what could break. Then compare the answer with the diff. A second agent or a code-review pass is a good extra check, never a substitute for your own read.
- Teach it once. When an agent makes a mistake it would repeat, add one line to `AGENTS.md`. Keep that file short.

### Reviewing a change an agent wrote

Look for what agents get wrong:

- Anything invented: a function, setting or figure that doesn't exist, or a comment that says something the code doesn't do.
- A safety cap bypassed, or a number put in a screen instead of `pace.js` or `fuel.js`.
- A blank or unreadable input read as zero.
- `innerHTML` from a variable, an empty `catch`, or a new network call.
- Checks described as run when they were not, or tests rewritten to pass rather than to test.
- The README or `docs/spec.md` not updated with the behaviour.
- More change than asked for, or a refactor mixed into a fix.
