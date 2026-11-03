# Race-day tools

Pace targets and a timed fuel plan for Standard and 70.3 triathlon, on one race card you can print for your top tube. It's a static web app. It runs on the athlete's phone with no account, no server and no health data held.

This is the first build of the race-day tool suite: the **Race Pacing Planner** and the **Race Fuel Planner**. Countdown and Debrief come later. The plan and the acceptance criteria are in [docs/spec.md](docs/spec.md).

> **Not ready to publish.** Every pacing and fuelling range is a typical value that has not yet been checked against current sources. See *Numbers to verify* below.

## Run it

```sh
npm run serve        # python3 -m http.server 8000 -d public, then open http://localhost:8000
```

Or open `public/index.html` straight from disk. There is nothing to build.

## Check it

```sh
npm test             # unit tests for the maths (Node 20+)
npm run smoke        # walks the whole journey in Chromium at phone size (needs Playwright)
```

Set `SHOTS=some/dir` before `npm run smoke` to save a screenshot of every screen.

## Look

The app uses the same design tokens as the Balance Tri Club apps, so it feels familiar to club members. It shares only the look: no sign-in, data or club branding. The tokens live in `public/css/app.css`.

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#182542` | Text and dark surfaces |
| Yellow | `#f8c44f` | The one primary button on a screen |
| Text blue | `#0070a8` | Links. Never use the club's brand blue `#00a3e0` for text on white: it fails contrast at 2.9:1 |
| Muted | `#566177` | Secondary text |
| Line | `#d9dfe8` | Borders |
| Canvas | `#f7f8fa` | Page background |
| Green | `#116b43` | Done, and the race card band |

- DM Sans for body and controls, Outfit for headings and the wordmark, both from Google Fonts.
- A 9 px corner radius on buttons, inputs and cards.
- A dashed outline marks a part of the race card that is still empty (the blank card on the first screen). It is the empty state of the stat tile, not a new component.
- Controls at least 44 px high and wide.
- One yellow action per screen; secondary actions are grey or outlined.
- Phone first, and light only.

## Hosting

**GitHub Pages, for now:** https://jthoyer.github.io/race-day-tools/

`.github/workflows/pages.yml` runs `npm test` on every push to `main` and, if it passes, publishes `public/` as it is. **Merging to `main` is a release**, live within a minute or two.

Set up outside the repo, so a rebuild would lose it: in the repo's **Settings → Pages**, *Source* is **GitHub Actions**.

GitHub Pages can't set response headers, so each page carries its content policy in a `<meta>` tag; `connect-src 'none'` means the page can make no network request. `public/_headers` keeps the full set (it adds `X-Frame-Options`, `frame-ancestors` and the others a `<meta>` tag can't) for a host that reads it, such as Cloudflare, the club apps' host.

The longer-term host and domain are still open (D4).

## Contributing

Branches, checks, the safety rules and the policy on AI agents are in [CONTRIBUTING.md](CONTRIBUTING.md). Agents also follow [AGENTS.md](AGENTS.md).

## How it fits together

| File | What it does |
| --- | --- |
| `public/index.html` | The app shell. Loads the scripts in order. |
| `public/js/pace.js` | Pacing maths: targets per leg, leg times, finish range. No DOM. |
| `public/js/fuel.js` | Fuel maths: carbs, fluid and sodium per leg, gel times, carry list. No DOM. |
| `public/js/time.js` | Parsing and formatting times and dates. |
| `public/js/store.js` | The one details store, in `localStorage`, shared by every tool. |
| `public/js/ui.js` | DOM helpers. Text always goes in as text, never as HTML. |
| `public/js/app.js` | The screens: home, set-up F1–F5, saved F6, fuel A2, race card C1, products, print. |
| `public/js/embed.js` | The tool inside a guide page. One step works alone; saving starts a plan. |
| `public/guides/` | Two draft guides with the tool inside: bike pacing and race fuel. |
| `public/_headers` | Security headers and the content policy. |
| `tests/` | Unit tests (`node --test`). |
| `scripts/smoke.mjs` | Browser smoke test. |

The maths files work in the browser and in Node, so the tests run with no browser.

### Safety rules in the code

- Planned carbs never pass the gut figure the athlete enters, on any leg. A drink too strong on its own gets diluted with water.
- Planned fluid never passes the sweat rate. Drinking more than you sweat is the main cause of exercise-associated hyponatraemia.
- Finish times are always a range, and the leg times always add up to it.
- "Not medical advice" appears beside every plan.

## Numbers to verify before launch

All of these sit at the top of `pace.js` and `fuel.js`, each marked `UNCHECKED`. Change them there, never in the screens.

| Number | Where | Current value |
| --- | --- | --- |
| Bike intensity factor | `BIKE_IF` | 70.3: 0.73–0.77 rolling; Standard: 0.83–0.88 rolling |
| Heat and old-test cuts | `HOT_IF_CUT`, `OLD_TEST_IF_CUT` | 0.02 each |
| Run off the bike | `RUN_FACTOR`, `RUN_HEAT` | 70.3: 1.08–1.13 × threshold; hot +4% |
| Swim in open water | `SWIM_FACTOR` | 70.3: 1.06–1.12 × CSS |
| Heart-rate and effort targets | `BIKE_HR`, `RUN_HR`, `EFFORT` | see file |
| Bike speed model | `BIKE_MODEL`, `COURSE_TIME` | CdA 0.29, Crr 0.005, rolling +4%, hilly +10% |
| Carb ceilings | `CARB_CEILING` | 70.3: bike 90, run 60 g/h; Standard: 60, 30 |
| Typical sweat rate | `TYPICAL_SWEAT` | 0.6 / 0.8 / 1.1 L/h by heat |
| Fluid share and limits | `REPLACE`, `FLUID_FLOOR`, `FLUID_CEILING` | bike 75% of sweat, 0.4–1.0 L/h |
| Sodium | `SODIUM_PER_L`, `SODIUM_RANGE` | 600–800 mg/L, 300–1,000 mg/h |

Good places to check them: the ACSM position stands on nutrition and on fluid replacement, and the consensus statements on exercise-associated hyponatraemia.

## Open decisions

These are from the blueprint and stay open. The code leaves room for each.

- **D2** Restoring a purchase with no accounts. No payments yet.
- **D3** Counting without tracking health data. No analytics yet.
- **D4** Email, offline copy and hosting.
- **D5** The name, and the fit with TRI Momentum.
- **D6** Where the paywall sits in pace set-up. Everything is free in this build.

## Sources

The Notion page "Strategy: Race-day tool suite" (product row RD-000) and its tool pages, and the race-day blueprint of 2 November 2026 (Option A's race plan with C's race card). Card keys in code comments, such as `RP-05-W2`, point to that blueprint.
