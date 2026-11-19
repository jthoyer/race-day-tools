# Counts and the dashboard

Decided 18 Nov 2026 (D3, owner). The app adds up anonymous counts, and a dashboard shows them. This page says what is stored, what the owner does outside the repo, and how the dashboard gets its numbers. The rules the code keeps are criterion 35 in [spec.md](spec.md).

## What is stored

One table in a Cloudflare D1 database. One row for each UTC day, kind and key, with a count.

| day | kind | key | n |
| --- | --- | --- | --- |
| 2026-11-18 | visit | google.com | 14 |
| 2026-11-18 | step | pacing2 | 9 |
| 2026-11-18 | card | 70.3 | 3 |

There is no id, no address, no user agent and nothing finer than the day. `kind` is `visit`, `step`, `card` or `emailed`. The values in the example are made up.

## Owner set-up for counts (not done, nothing checked)

An agent does not do these. Each changes the Cloudflare account, so the owner says when.

1. **Create the database.** In Cloudflare: Storage and databases, D1, create `race-day-counts`. Or `npx wrangler d1 create race-day-counts`.
2. **Create the table.** Run this once in the D1 console (the same text is `SCHEMA` in `functions/api/event.js`):

   ```sql
   CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key));
   ```
3. **Bind it.** Pages project `race-day-tools`, Settings, Bindings, add a D1 binding. Name it `STATS`. Do it for Production. Leave Preview unbound on purpose: a preview then answers `later` and counts nothing.
4. **Add a rate-limiting rule** for POST `/api/event`, like the one on `/api/send`. The in-memory limiter is a best effort only. Check first whether the plan allows another rule.
5. **Redeploy production**, then open the live site, click through two screens and check rows appear:

   ```sql
   SELECT * FROM counts ORDER BY day DESC, kind, key;
   ```
6. **Confirm the footer wording** (About, "How to get it"). It is a draft by an agent.

Until step 3 is done the function answers 503 and the app carries on. Nothing breaks.

## The dashboard

The dashboard is a private claude.ai page. It does not read the database itself, so the app exposes no read address. A person or a scheduled task asks Claude to refresh it. Claude reads the table from D1 through the Cloudflare API and writes a snapshot into the page's own store.

It answers three questions:

- **Where did people come from?** `visit` rows, by key.
- **Where did they stop?** `step` rows as a funnel: home, race, pacing1, pacing2, pacing3, nutrition, card, then `emailed`.
- **How many race cards for each distance?** `card` rows by distance, and `emailed` beside them.

Read the numbers as page loads, not people. A reload counts again. A script can post to `/api/event`, so treat the tally as a guide.
