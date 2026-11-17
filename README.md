# Race-day tools

Pace targets and a timed nutrition plan for Olympic and 70.3 triathlon, on one race card you can email to yourself as a PDF. It's a static web app. It runs on the athlete's device with no account and no health data held. The one thing that leaves the device is a PDF of the race card, and only when the athlete types an address and taps to email it. Every screen carries the TRI Momentum name; the repo stays `race-day-tools`.

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
| Yellow hover (`--accent-hover`) | `#f6cf69` | The labels and edit buttons on an ink band (the race card header and the race strip), and the yellow button on hover |
| Light blue (`--info-bg`) | `#eaf7fc` | Step 4, the race card, in the status row, the Race plan panel and the step list |

- DM Sans for body and controls, Outfit for headings and the wordmark. Both are open fonts (SIL Open Font License). They ship in `public/fonts/`, so no page asks another host for anything. The licence text is in `public/fonts/LICENSE.txt`.
- A 9 px corner radius on buttons, inputs and cards.
- The race strip: an ink band under the status row on pacing and step 3 (the race, its countdown, Edit race and Edit taper). It scrolls with the page, like the status row. It is the race card header's band, closed, and uses `--accent-hover` for its buttons.
- The status row and the Race plan panel: a read-only row under the header on every step and the race card, except step 3 with no race ("Step 2 of 4", the step's name, "Next: ..." and four bars; after race day, "Race done" and one green "Plan complete" bar). A "Race plan" button in the header opens a panel with the four step links and a locked "Review your race" row. In the panel, done is a green circle with a tick, the current step is ink and says "You are here", and step 4 stays on the light blue with a blue ring until it is current. Neither is sticky.
- The wordmark: three ink boxes holding white T, R and I, then "Momentum" in Outfit.
- Controls at least 44 px high and wide.
- One yellow action per screen; secondary actions are grey or outlined.
- Phone first, and light only.

## Hosting

**Cloudflare Pages:** https://race.trimomentum.com. The Pages project is `race-day-tools`, built from `main`, output folder `public`, no build command. Read from the Cloudflare account on 16 November 2026.

**GitHub Pages, the old copy:** https://jthoyer.github.io/race-day-tools/ still publishes (it answered on 16 November 2026). Step 11 of the host move retires it.

`.github/workflows/pages.yml` runs `npm test` on every push to `main` and, if it passes, publishes `public/` to the GitHub Pages copy. Cloudflare builds `main` on its own, through its Git integration, and does not wait for that check ([docs/host-move.md](docs/host-move.md)). Whether the `unit` check is required on `main` is a GitHub setting this repo cannot show: look in the repo's Settings, under Rules. **Merging to `main` is a release**, live within a minute or two.

Set up outside the repo, so a rebuild would lose it: in the repo's **Settings → Pages**, *Source* is **GitHub Actions**.

GitHub Pages can't set response headers, so each page carries its content policy in a `<meta>` tag; `connect-src 'self'` means the page can call only its own address, for the one send function, and no other host. On GitHub Pages that function does not exist and an address would be posted to GitHub, so the email block is hidden on `github.io` (`canEmailHere` in `public/js/card.js`); it appears when the app is served from Cloudflare or localhost. `public/_headers` keeps the full set (it adds `X-Frame-Options`, `frame-ancestors` and the others a `<meta>` tag can't) for a host that reads it, such as Cloudflare, the club apps' host.

The move to Cloudflare Pages, in order, with its checks and its roll-back, is in [docs/host-move.md](docs/host-move.md). Steps 1 to 10 are mostly done and step 11 is open: see the table there. Whether `race.trimomentum.com` is the long-term domain is still open (D4).

**Owner set-up for email, as of 16 November 2026.** Checked means read from the Cloudflare account or the live site that day, with no write. The email block shows on `race.trimomentum.com`, and **RD-005 is still open**: every range below is `UNCHECKED`, and the PDF carries them off the device.

- Create the Resend account and a send-only key. Done: a commit on 16 November says the send works. No agent has sent one.
- Set `RESEND_API_KEY` and `MAIL_FROM` as secrets on the host, never in the repo. Done. Checked: production holds both names and preview holds none. The values were not read.
- A separate sending subdomain with SPF, DKIM and DMARC. Partly. Checked: the subdomain is `mail.trimomentum.com`, with a DKIM key and Resend's two CNAMEs. DMARC is `v=DMARC1; p=none;`, which only monitors. The zone has no SPF TXT record, and whether Resend's CNAME covers it is not checked. Whether Resend shows the domain verified is not checked.
- A Cloudflare rate-limiting rule on POST `/api/send`; the in-code limiter is best-effort per instance and is not a real limit. Done. Checked: "Limit email sends" blocks an IP for 10 seconds after more than 5 POSTs in 10 seconds.
- Resend usage alerts or a cap. Not recorded.
- The host move from GitHub Pages to Cloudflare Pages (step 5). Mostly done; step 11 is open. Steps and checks: [docs/host-move.md](docs/host-move.md). Cloudflare deploys through its Git integration and does not wait for the `npm test` check unless branch protection requires it.
- Check Resend's data retention against the "We don't keep it" wording. Not checked.
- Check the Resend request shape (endpoint, header, body) against Resend's docs. Not checked. It is UNVERIFIED, although a real send works.

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
| `public/js/card.js` | The race card as a PDF: the rows of text (the words the PDF holds, no DOM), the one-page drawing, and the address check. Reads the saved plan; does no maths. |
| `public/js/vendor/` | jsPDF, vendored at a pinned version with its licence, unedited. Draws the PDF on the device. |
| `public/js/app.js` | The screens: home (the front page, with a Learn more section and the guide links at its bottom, and coming back), step 1 race, step 2 pacing in three parts, step 3 nutrition, step 4 race card, My products, and the status row and Race plan panel (Race, Pacing, Nutrition, Race card) that join them. The race strip, an ink band under the status row on pacing and step 3, shows the race and its countdown with Edit race and Edit taper. |
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

**Email must not go live while these ranges are marked UNCHECKED (RD-005):** the PDF carries them off the device and has no DRAFT mark (the owner decided no DRAFT mark, 13 Nov 2026).

Good places to check them: the ACSM position stands on nutrition and on fluid replacement, and the consensus statements on exercise-associated hyponatraemia.

## Open decisions

These are from the blueprint and stay open. The code leaves room for each.

- **D2** Restoring a purchase with no accounts. No payments yet.
- **D3** Counting without tracking health data. No analytics yet.
- **D4** Hosting and an offline copy. The email path is decided (13 Nov 2026); the offline copy and the host move are open.
- **D6** Where the paywall sits in pace set-up. Everything is free in this build.

Decided:

- **D5** The name, and the fit with TRI Momentum (owner, 9 November 2026). The suite is TRI Momentum's wedge, not a separate business, so it has no name of its own: every screen header and tab title says TRI Momentum. The repo stays `race-day-tools`.

## Sources

The Notion page "Strategy: Race-day tool suite" (product row RD-000) and its tool pages, and the race-day blueprint of 2 November 2026 (Option A's race plan with C's race card). Card keys in code comments, such as `RP-05-W2`, point to that blueprint.
