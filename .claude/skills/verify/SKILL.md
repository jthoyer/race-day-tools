---
name: verify
description: How to run and check TRI Momentum (the race-day tools), a static web app in public/ with no build step.
---

# Verify TRI Momentum (race-day tools)

- **Launch:** `git worktree add --detach <dir> <sha>` for a pinned copy, then `python3 -m http.server <port> -d <dir>/public`. No env vars, nothing to install.
- **Seed:** smoke seeds its own storage. For old saves, copy `scripts/fixtures/save-before-four-step.json` (a made-up athlete), set `race.date` to a future day, and inject it into `localStorage['race-day-tools.v1']` with `addInitScript` guarded by `if(!getItem)`.
- **Widths:** 390, 360, 320. No `@media` breakpoint other than print.
- **Checks:** `npm test` ends `# fail 0`. `npm run smoke` ends `Smoke test passed.` with no `failed:` lines (`SHOTS=<dir>` saves screenshots). `require('playwright')` works from any directory. For print, dispatch `window.dispatchEvent(new Event('beforeprint'))`, then `emulateMedia({media:'print'})`, and read `#print-root`. Useful ids: gut field `#f-details-gut`, own sweat `#f-details-sweat`, rail `nav.rail`.
- **Traps:** the router uses hashes, so use `getByText` for "Next: ..." buttons, not `getByRole('link')`. `getByLabel(/sweat rate/i)` matches the pill group first. The print card is built only on `beforeprint`. Remove worktrees with `git worktree remove --force`.
