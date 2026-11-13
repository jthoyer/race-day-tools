---
name: verify
description: How to run and check TRI Momentum (the race-day tools), a static web app in public/ with no build step.
---

# Verify TRI Momentum (race-day tools)

- **Launch:** `cd /home/user/race-day-tools && python3 -m http.server 8765 -d public &`, then open http://localhost:8765/index.html. For a pinned copy: `git worktree add --detach <dir> <sha>` and serve `<dir>/public`. `npm run smoke` starts its own server. No env vars.
- **Playwright:** `NODE_PATH=/opt/node-tools/node_modules`, `require('playwright').chromium.launch()` with no options. Do not run `playwright install`.
- **Seed:** put JSON under `localStorage['race-day-tools.v1']` with `addInitScript`, only if the key is empty, so reloads keep state. Use a made-up race (`{name, distance:'70.3', date, taperDays:null}`) plus details and fitness, or `scripts/fixtures/save-before-four-step.json` with `race.date` moved to a future day. After `goto`, call `reload()`.
- **Widths:** 390x844, 360x640, 320x568, deviceScaleFactor 1. Only a print `@media` exists.
- **Checks:** `npm test` prints `# pass 65` and `# fail 0`. `npm run smoke` ends `Smoke test passed.` with no `failed:` lines (333 `ok` lines at the last run; `SHOTS=<dir>` saves screenshots). `section.strip` is the sibling right after `nav.rail`; its rows are `button.srow` at 60 px or more, ids `strip-edit-race` and `strip-edit-taper`, panels `strip-panel-race` and `strip-panel-taper` (one at a time). Scrolling 600 px puts the strip top below 0 and the rail top at 0 or more. After taper, name or date edits through the strip, `JSON.stringify` of `race.pace` and `race.fuel` equals the earlier snapshot. `document.documentElement.scrollWidth <= innerWidth` at each width. For print, dispatch `window.dispatchEvent(new Event('beforeprint'))`, then `emulateMedia({media:'print'})`, and read `.tt`. Other ids: gut field `#f-details-gut`, own sweat `#f-details-sweat`.
- **Traps:** python `http.server` sends no `_headers` CSP, so only the meta policy is exercised. `#/` routes need `goto` then `reload` to re-render from storage. A no-date strip case needs `date: null` (or `''`). en-AU short dates render with a comma ("Thu, 3 Dec"), and June, July and Sept are four letters: match `\d+ \w{3,4}`, never a fixed string. The "Next: ..." controls are buttons, not links. `getByRole('link', {name:'Edit'})` also matches "Edit taper" unless `exact: true`. `getByLabel(/sweat rate/i)` matches the pill group first. The print card is built only on `beforeprint`. Remove worktrees with `git worktree remove --force`.
