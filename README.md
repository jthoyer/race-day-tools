# Race-day tools

Pace targets and a timed nutrition plan for Olympic and 70.3 triathlon, on one race card you can print for your top tube. It's a static web app. It runs on the athlete's phone with no account and no health data held. The one thing that leaves the phone is a PDF of the race card, and only when the athlete types an address and taps to email it. Every screen carries the TRI Momentum name; the repo stays `race-day-tools`.

This is the first build of the race-day tool suite: the **Race Pacing Planner** and the **Race Fuel Planner** (shown to people as nutrition), in a four-step flow: choose a race, choose pacing, review nutrition, get the race card. Countdown and Debrief come later. The plan and the acceptance criteria are in [docs/spec.md](docs/spec.md).

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
| Ink | `#182542` | Text and dark surfaces, including the race card header |
| Yellow | `#f8c44f` | The one primary button on a screen |
| Text blue | `#0070a8` | Links. Never use the club's brand blue `#00a3e0` for text on white: it fails contrast at 2.9:1 |
| Muted | `#566177` | Secondary text |
| Line | `#d9dfe8` | Borders |
| Canvas | `#f7f8fa` | Page background |
| Green | `#116b43` | Done |
| Light blue (`--info-bg`) | `#eaf7fc` | Step 4, the race card, in the rail and the step list |

- DM Sans for body and controls, Outfit for headings and the wordmark. Both are open fonts (SIL Open Font License). They ship in `public/fonts/`, so no page asks another host for anything. The licence text is in `public/fonts/LICENSE.txt`.
- A 9 px corner radius on buttons, inputs and cards.
- The rail: four numbered steps on every step and the race card. Done is a green circle with a tick, the current step is ink, and step 4 stays on the light blue with a blue ring until it is current.
- The wordmark: three ink boxes holding white T, R and I, then "Momentum" in Outfit.
- Controls at least 44 px high and wide.
- One yellow action per screen; secondary actions are grey or outlined.
- Phone first, and light only.

## Hosting

**Cloudflare Pages:** https://race.trimomentum.com

Cloudflare Pages deploys the app from `main`: output folder `public`, no build command, the send function from `/functions`. **Merging to `main` is a release**, live within a minute or two. Cloudflare does not wait for `npm test`. Branch protection on `main` requires the `unit` check from `.github/workflows/test.yml`, so a failing test blocks the merge. Every pull request gets a preview address too. The preview has no secrets, so a send from it returns the "try later" reply. That is expected.

`public/_headers` sets the full header set on the pages. Cloudflare does not apply it to replies from Pages Functions, so `functions/api/send.js` sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on its own replies. Each page also carries its content policy in a `<meta>` tag; `connect-src 'self'` means the page can call only its own address, for the one send function, and no other host. Keep the four copies in step.

**The old address.** `https://jthoyer.github.io/race-day-tools/` no longer updates, because the publish workflow was retired on the move. It should keep serving its last build. That build has no email block: `/api/send` does not exist there and an address would be posted to GitHub, so the block is hidden on `github.io` (`canEmailHere` in `public/js/card.js`). Treat it as a frozen fallback. Turning it off is in the repo's **Settings → Pages**, by hand.

The move is in [docs/host-move.md](docs/host-move.md), with its checks.

**Owner set-up for email, outside the repo.** The owner reported these on 16 November 2026. Nothing here has been re-checked from the repo.

Done:

- The Pages project `race-day-tools`, with the custom domain `race.trimomentum.com`.
- A Resend account and a send-only key. Mail goes out from `mail.trimomentum.com`, which Resend shows as verified, in region Tokyo (`apne1`).
- DNS in the `trimomentum.com` zone for Resend: a DKIM TXT, two CNAMEs and a DMARC TXT with `p=none` (monitor only). Keep the two Resend CNAMEs DNS-only (grey cloud).
- `RESEND_API_KEY` and `MAIL_FROM` as Production secrets, never in the repo.
- A Cloudflare rate-limiting rule on POST `/api/send`: five requests per 10 seconds per IP, then a 10-second block. Those are the only values the free plan allows. The in-code limiter stays a best-effort extra.
- Branch protection on `main` that requires the `unit` check.
- A live send returned "Ok" in the Pages log stream. That shows the function replied, not that the email arrived.

Not done:

- Resend usage alerts or a cap.
- Check Resend's data retention against the "We don't keep it" wording, and the Tokyo region against the privacy statement (RD-040).
- Check the Resend request shape (endpoint, header, body) against Resend's docs. A live send works today, but the shape is not checked against the docs.
- Launch. Do not announce email while RD-005 (ranges still `UNCHECKED`), RD-034 or RD-040 is open.

## Contributing

Branches, checks, the safety rules and the policy on AI agents are in [CONTRIBUTING.md](CONTRIBUTING.md). Agents also follow [AGENTS.md](AGENTS.md).

## How it fits together

| File | What it does |
| --- | --- |
| `public/index.html` | The app shell. Loads the scripts in order. |
| `public/js/pace.js` | Pacing maths: targets per leg, leg times, finish range, and the approximate km beside a gel time (`kmAt`). No DOM. |
| `public/js/fuel.js` | Nutrition maths (the file keeps its older name): carbs, fluid and sodium per leg, gel times, carry list. No DOM. |
| `public/js/time.js` | Parsing and formatting times and dates. |
| `public/js/store.js` | The one details store, in `localStorage`, shared by every tool. |
| `public/js/ui.js` | DOM helpers. Text always goes in as text, never as HTML. |
| `public/js/card.js` | The race card as a PDF: the rows of text (the same words as the print card, no DOM), the one-page drawing, and the address check. Reads the saved plan; does no maths. |
| `public/js/vendor/` | jsPDF, vendored at a pinned version with its licence, unedited. Draws the PDF on the phone. |
| `public/js/app.js` | The screens: home (the front page, and coming back, with the guide links at the bottom of the front page), step 1 race, step 2 pacing in three parts, step 3 nutrition, step 4 race card, My products, print, and the rail (Race, Pacing, Nutrition, Race card) that joins them. |
| `public/js/embed.js` | The tool inside a guide page. One step works alone; saving starts a plan. |
| `public/guides/` | Two draft guides with the tool inside: bike pacing and race nutrition (`race-fuel.html`). |
| `functions/api/send.js` | The one server function (a Cloudflare Pages Function). Takes `{ email, pdf }`, checks them, and sends one email with the PDF through Resend. Stores nothing durable (the limiter keeps hashes of the address and visitor in memory only); logs only a status code and a count. Runs only on Cloudflare; the key and sender come from its environment. |
| `public/_headers` | Security headers and the content policy. |
| `public/fonts/` | DM Sans and Outfit as variable `.woff2` files, in two subsets each (Latin, and Latin Extended for other letters), with their licence. Declared at the top of `css/app.css`. |
| `tests/` | Unit tests (`node --test`). |
| `scripts/smoke.mjs` | Browser smoke test. |

The maths files work in the browser and in Node, so the tests run with no browser.

### Safety rules in the code

- Planned carbs never pass the gut figure the athlete enters, on any leg. A drink too strong on its own gets diluted with water.
- Planned fluid never passes the sweat rate. Drinking more than you sweat is the main cause of exercise-associated hyponatraemia.
- Finish times are always a range, and the leg times always add up to it, with the athlete's own T1 and T2 too.
- Gel times the athlete sets are refused if they would pass the gut figure. The suggested times stay.
- "Not medical advice" appears beside every plan.

## Numbers to verify before launch

All of these sit at the top of `pace.js` and `fuel.js`, each marked `UNCHECKED`. Change them there, never in the screens. The Olympic distance is stored as `standard` in the code and in saved plans, so older saves still load; only the label changed.

| Number | Where | Current value |
| --- | --- | --- |
| Bike intensity factor | `BIKE_IF` | 70.3: 0.73–0.77 rolling; Olympic: 0.83–0.88 rolling |
| Heat and old-test cuts | `HOT_IF_CUT`, `OLD_TEST_IF_CUT` | 0.02 each |
| Run off the bike | `RUN_FACTOR`, `RUN_HEAT` | 70.3: 1.08–1.13 × threshold; hot +4% |
| Swim in open water | `SWIM_FACTOR` | 70.3: 1.06–1.12 × CSS |
| Heart-rate and effort targets | `BIKE_HR`, `RUN_HR`, `EFFORT` | see file |
| Bike speed model | `BIKE_MODEL`, `COURSE_TIME` | CdA 0.29, Crr 0.005, rolling +4%, hilly +10% |
| Changeovers, our guide | `T1`, `T2` | 70.3: T1 4–5, T2 2–4 min; Olympic: T1 2–3, T2 1–2 min (they add up to the old combined 6–9 and 3–5) |
| Taper length | `TAPER` | guide 14 days for a 70.3, 10 for an Olympic; offered 10, 14, 21; a picked day 1–42 days out |
| Carb ceilings | `CARB_CEILING` | 70.3: bike 90, run 60 g/h; Olympic: 60, 30 |
| Typical sweat rate | `TYPICAL_SWEAT` | 0.6 / 0.8 / 1.1 L/h by heat |
| Fluid share and limits | `REPLACE`, `FLUID_FLOOR`, `FLUID_CEILING` | bike 75% of sweat, 0.4–1.0 L/h |
| Sodium | `SODIUM_PER_L`, `SODIUM_RANGE` | 600–800 mg/L, 300–1,000 mg/h |
| Gel timing limits | `TIMING_EVERY`, `END_GAP` | a gel every 5–120 min; none in the last 10 min of a leg |
| Carb list on My products | `CARB_PICK` | 20–50 g in 5 g steps (a figure off the list goes under Other) |

**Email must not go live while these ranges are marked UNCHECKED (RD-005):** the PDF carries them off the phone and has no DRAFT mark (the owner decided no DRAFT mark, 13 Nov 2026).

Good places to check them: the ACSM position stands on nutrition and on fluid replacement, and the consensus statements on exercise-associated hyponatraemia.

## Open decisions

These are from the blueprint and stay open. The code leaves room for each.

- **D2** Restoring a purchase with no accounts. No payments yet.
- **D3** Counting without tracking health data. No analytics yet.
- **D4** Hosting and an offline copy. The email path is decided (13 Nov 2026); the host move is done (16 Nov 2026) and the offline copy is open.
- **D6** Where the paywall sits in pace set-up. Everything is free in this build.

Decided:

- **D5** The name, and the fit with TRI Momentum (owner, 9 November 2026). The suite is TRI Momentum's wedge, not a separate business, so it has no name of its own: every screen header and tab title says TRI Momentum. The repo stays `race-day-tools`.

## Sources

The Notion page "Strategy: Race-day tool suite" (product row RD-000) and its tool pages, and the race-day blueprint of 2 November 2026 (Option A's race plan with C's race card). Card keys in code comments, such as `RP-05-W2`, point to that blueprint.
