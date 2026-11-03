# Spec: Race Fuel Planner and Race Pacing Planner (first build)

Written 3 November 2026 from the Notion strategy page "Strategy: Race-day tool suite" (RD-000), the two tool pages ("Race Fuel Planner", "Race Pacing Planner") and the blueprint of 2 November 2026 (strategy, journey, set-up flow, screens F1–F7, A1, A2, C1). Card keys such as `RP-05-W2` refer to that blueprint.

## Objective

One static web app that holds the first two race-day tools, the Pacing Planner and the Fuel Planner. They share the athlete's details and write to one race card. Pace splits feed the fuel plan.

## Acceptance criteria

Each is checkable. The tests that cover each one are named.

1. **Static and on-device.** `public/` runs from any static server with no build step. No accounts, no server calls, no analytics. State lives in `localStorage` under one key. Every storage read and write survives storage being blocked. (`store.js`; smoke test reload check)
2. **Set-up flow F1–F5** follows the blueprint: F1 race, distance, date, an optional start time, an optional transition opening time, days to go and taper start; F2 weight (with a line saying it turns a power target into a bike time and does not change the fuel plan), sweat rate (or typical), gut tolerance; F3 Power / Heart rate / Effort with CSS (critical swim speed, with a line saying what it is and why we ask), FTP (and when tested), run threshold; F4 course and heat; F5 targets. (smoke test)
3. **Plausible inputs only (RP-03-A1).** Next refuses out-of-range or unreadable numbers, with a message by the field. A blank field is never read as zero. A message goes as soon as what is typed reads, and a new one waits for the person to leave the field or press Next. Times can be typed as digits ("130" is 1:30, "245" is 2:45) or with a dot ("1.30"), and the field shows the time it read when the person leaves it. One or two digits ("45"), seconds or minutes of 60 or more, and a row of zeros are refused, never guessed, with a message that says what to type. A comma is not read. (`pace.test.js` "implausible numbers"; `fuel.test.js` "blank gut figure"; `time.test.js`; smoke test F2 and F3)
4. **A range, never one time (RD-05-A2).** Every leg time and the finish are ranges. (`pace.test.js` "legs always add up")
5. **The numbers add up (RP-05-W2).** The finish range is exactly the sum of the displayed leg minutes and changeovers. (`pace.test.js`) When a start time is set, the targets screen, the race card and the print card also show the finish as a time of day: the start plus that finish range, to the minute, as a range marked "about", and "next day" after midnight. With no start time they show a link to add one and no time. (`time.test.js`; smoke test)
6. **Blueprint worked example.** 70.3, FTP 240 W, CSS 1:45, run threshold 4:50 /km, 72 kg, rolling, warm gives a bike target of 175–185 W and a run of 5:15–5:30 /km. (`pace.test.js`; smoke test F5)
7. **"How we got these" (RP-05-E3)** is open by default on F5.
8. **Pace feeds fuel (RD-05-A1, RP-06-A2).** Saving F5 writes targets to the race card and shows F6, whose "Plan my fuel" opens Fuel with the bike and run times filled in. The fuel step shows those times as swim, bike and run tiles in the race card's style (the middle of each pace range, which is what the plan uses), and its plan opens with the carry list, with the cap and safety note last. A saved fuel plan is marked out of date when anything it was made from changes: splits, details, products or heat. (smoke test)
9. **Gut cap (RD-02-A1, RP-02-A2).** Planned carbs per hour, drink and gels together, never pass the gut figure on any leg, for any product. A drink too strong on its own is diluted with water, with a warning. (`fuel.test.js`)
10. **Fluid cap (RD-02-W1).** Planned fluid never passes the sweat rate. (`fuel.test.js`)
11. **Own products (RD-02-A3).** People can add, edit and remove gels, chews and drinks. Typical defaults are generic, with no brand names. Carbs per serve is picked from a list of 20 to 50 g in 5 g steps, or typed exactly under Other. A saved figure that is not on the list shows as it is under Other and is never rounded to a step. (smoke test)
12. **Not medical advice (RD-02-A2)** appears beside every plan, on the card and on the print.
13. **Guide embeds (RD-02-A4, F7, RP-07).** A guide page runs one step on its own with no race set up. "Save to a race plan" starts a plan and carries the guide's numbers in. (smoke test)
14. **Printable top-tube card (RD-07-A2).** Print shows only a card about 7 cm wide with pace targets and fuel times. (smoke test)
15. **Phone first.** No sideways scroll at 390 px. Tap targets at least 44 px. Text goes into the page as text, never as HTML. The date and start time fields on the first set-up screen sit side by side inside the page with a gap at 390, 360 and 320 px (smoke test, which runs in Chromium only; the original overflow was seen in iOS Safari and needs a check on a phone).
16. **Blank card start (decided 4 Nov 2026).** The first screen is an empty race card. Its band says "Name your race", empty parts have a dashed outline, and "Start my race card" and "Just plan my fuel" sit under it. A race with no name, date, pace or fuel shows the same screen, so Cancel on step 1 returns to it. The guides sit below as gallery cards: one column on a phone, two across when there is room, each at least 44 px high, each tagged Draft while its ranges are unchecked. (smoke test)
17. **Optional race times (RD-019, decided 4 Nov 2026).** Start time and Transition opens are both optional and start blank. A blank time is never read as midnight, and 00:00 is a real time. When both are set, the transition opens before the start. If not, a message shows by the field, the entry is not saved and Next stays put. Each time can be cleared. A time shows on the home screen, the race card and the print card only when it is set, and never as a label with nothing after it. (`time.test.js`; smoke test)

## Out of scope

Payments and the paywall (D6), email (D4), the gut-training ladder, Countdown, Debrief, an offline copy (RD-07-S1), analytics (D3), hosting and deployment, the SEO pipeline, and published guide copy. Countdown and Debrief are hidden everywhere (the card, the home plan list and the fuel step bar) until they exist, so nothing promises a tool that is not there (decided 4 Nov 2026).

## Known limits

- Every range in `pace.js` and `fuel.js` is typical and **unchecked** (RP-05-W1, RD-01-W2). Verify each before launch.
- The bike time comes from a simple physics model (CdA 0.29, Crr 0.005). It lands near, not on, the blueprint example: 2:47–2:51 against 2:41–2:48.
- One race at a time. "Start a new race" replaces it and keeps the details.
- The strategy sequences Pacing after Gate 1. This build makes both now, at the owner's request (3 Nov 2026).
