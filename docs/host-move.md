# Host move: GitHub Pages to Cloudflare Pages

**Status: done on 16 November 2026, once the cut-over pull request merges.** This is step 5 of the RD-039 plan. The app runs on Cloudflare Pages at https://race.trimomentum.com. Steps 1 to 6 and the extra step are done. Steps 7 and 8, and the failure and bad-address checks in step 10, are not. The old GitHub Pages address is a frozen fallback. This page stays as the record of the plan and its checks.

An agent can edit this repo. Only you can touch Cloudflare, DNS, the mail account and GitHub settings (see AGENTS.md and CONTRIBUTING.md). Each step below is a row in the Notion product backlog, "Host move 1 of 11" to "11 of 11", under RD-039.

What I read in Cloudflare's docs on 16 November 2026 is marked **(docs)**. Anything not marked is not checked.

## Decide first: how Cloudflare deploys

**Git integration** (the plan's choice). Cloudflare watches the repo and deploys on every push to the production branch. **(docs)** It does not wait for GitHub Actions. So "merging deploys once `npm test` passes" stops being true. A project made this way cannot switch to Direct Upload later. **(docs)**

To keep the test gate, turn on branch protection for `main` in GitHub and require the `unit` check from `.github/workflows/test.yml`. That workflow runs on every pull request. You set this by hand.

**Direct Upload from Actions** keeps the gate inside the workflow: run `npm test`, then `wrangler pages deploy public`. It needs a Cloudflare API token stored as a GitHub secret, and more set-up. Not planned.

Pick one before step 1.

## Before step 1: the stray `race-day` Worker

A read-only check of the Cloudflare account on 16 November 2026 found no Pages project. It found one **Worker** named `race-day`, linked to this repo on `main`. It builds with `npx wrangler deploy` from the root directory `/race-day`, which is not a folder in this repo. Its latest Git build failed. It has no routes, no domain and no secrets.

The decision on 16 November 2026 is **Pages**, not a Worker. The send function is a Pages Function (`functions/api/send.js`), and the Worker route would need it rewritten.

So the Worker is not part of the plan. Disconnect its Git link or delete it, by hand, so it stops building on every push to `main`. I have not checked whether its failed build shows as a check on pull requests. The Pages project is a new one: in the dashboard, Workers & Pages, Create application, the Pages tab, import the Git repository. **(docs)** Leave the root directory empty.

## The order

| # | Who | Step |
| --- | --- | --- |
| 1 | You | Create the Pages project (not a Worker). Connect the repo. Output folder `public`, no build command. Deploy a preview. |
| 2 | You | Open the Resend account. Create a send-only key. Check its data retention against "We don't keep it". |
| 3 | You | Choose the sending domain. Use a subdomain. |
| 4 | You | Add SPF, DKIM and DMARC records. Wait for Resend to show the domain verified. |
| 5 | You | Add `RESEND_API_KEY` and `MAIL_FROM` as **secrets**, preview first. |
| 6 | You | Add a Cloudflare rate-limiting rule on POST `/api/send`. |
| 7 | You | Set a Resend usage alert or cap. |
| 8 | Agent | Check the Resend request shape in `functions/api/send.js` against Resend's docs. |
| 9 | Agent | This branch: the docs, ready for the cut-over. |
| 10 | You, then agent | Check the preview (below). |
| 11 | You, then agent | Move DNS. Keep GitHub Pages live until the new address is checked. Then retire `pages.yml`. DNS is done. The retiring is in the cut-over pull request. |
| extra | You | Require the `unit` check on `main` in GitHub, with a branch protection rule or a ruleset. On 16 November 2026 `main` had neither. Do it before step 11. |

Notes on step 5. In the dashboard: Settings, Variables and Secrets, Add, then Encrypt. Or `npx wrangler pages secret put <KEY> --project-name <project>`. **(docs)** Set them before the deployment that uses them, and redeploy after. **(docs)** Preview and production are separate.

Note on step 6. The limiter inside `send.js` is best effort, per instance. The Cloudflare rule is the real limit. I have not checked the rule's menu path or limits. Read Cloudflare's current page when you do it.

## Step 10: check the preview

Use made-up data. Send only to an address you own.

- [ ] The app and both guide pages load, with their fonts.
- [ ] Static pages carry the headers in `public/_headers`. Look at the response headers in the browser's network tab.
- [ ] `/api/send` replies carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. `send.js` sets these itself. Cloudflare does not apply `_headers` to responses from Pages Functions. **(docs)** So `/api/send` does not get the CSP, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy`. That is fine for a JSON reply, but "the full header set applies" is true for the pages only.
- [ ] The email block shows. It is hidden on `github.io` (`canEmailHere` in `public/js/card.js`).
- [ ] One real send arrives with the PDF, in a few minutes.
- [ ] With the secrets removed or wrong, the app says "Email isn't working right now" and the plan stays.
- [ ] A bad address is refused with no request.
- [ ] `send.js` uses `redirect: 'manual'` on the call to Resend. Workers does not support `redirect: 'error'`. It throws before any request goes out, and the catch turns that into the "Email isn't working right now" reply. Do not change it back. A real send is the only test that shows this.

## What changed in the repo at cut-over (step 11)

One small pull request:

- README, Hosting section: the new address, and what you set up by hand.
- CONTRIBUTING, "Branches and pull requests": the line about merging to `main` now names the Cloudflare address and the required `unit` check.
- `.github/workflows/pages.yml` is deleted. GitHub Pages no longer updates.
- No change to `canEmailHere`. GitHub Pages stays a host without the function.
- No change to the content policy. It stays `connect-src 'self'`.

## Roll back

The old address `https://jthoyer.github.io/race-day-tools/` should keep serving its last build, frozen. It has no email block. To go back to it, point people at that address. It will not have anything merged after the move. To bring it up to date, restore `pages.yml` from Git history. A custom domain moved to Cloudflare stays on Cloudflare unless you change its DNS.

## Still blocks launch

The move is not the launch. Do not announce email while RD-005 (ranges still `UNCHECKED`), RD-034 or RD-040 is open.
