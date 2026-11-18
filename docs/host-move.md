# Host move: GitHub Pages to Cloudflare Pages

**Status, 16 November 2026: steps 1 to 10 are mostly done; step 11 is open.** This is step 5 of the RD-039 plan. The Cloudflare Pages project serves https://race.trimomentum.com, and the GitHub Pages copy still publishes too. The "State" column below says what was seen. **Checked** means read from the Cloudflare account or the live site on 16 November 2026, with no write.

An agent can edit this repo. Only you can touch Cloudflare, DNS, the mail account and GitHub settings (see AGENTS.md and CONTRIBUTING.md). Each step below is a row in the Notion product backlog, "Host move 1 of 11" to "11 of 11", under RD-039.

What I read in Cloudflare's docs on 16 November 2026 is marked **(docs)**. Anything not marked is not checked.

## Decide first: how Cloudflare deploys

**Git integration** (the plan's choice). Cloudflare watches the repo and deploys on every push to the production branch. **(docs)** It does not wait for GitHub Actions. So "merging deploys once `npm test` passes" stops being true. A project made this way cannot switch to Direct Upload later. **(docs)**

To keep the test gate, turn on branch protection for `main` in GitHub and require the `unit` check from `.github/workflows/test.yml`. That workflow runs on every pull request. You set this by hand.

**Direct Upload from Actions** keeps the gate inside the workflow: run `npm test`, then `wrangler pages deploy public`. It needs a Cloudflare API token stored as a GitHub secret, and more set-up. Not planned.

Pick one before step 1.

## Before step 1: the stray `race-day` Worker

A read-only check of the Cloudflare account earlier on 16 November 2026 found no Pages project. It found one **Worker** named `race-day`, linked to this repo on `main`. It builds with `npx wrangler deploy` from the root directory `/race-day`, which is not a folder in this repo. Its latest Git build failed. It has no routes, no domain and no secrets.

The decision on 16 November 2026 is **Pages**, not a Worker. The send function is a Pages Function (`functions/api/send.js`), and the Worker route would need it rewritten.

So the Worker is not part of the plan. Disconnect its Git link or delete it, by hand, so it stops building on every push to `main`. Later on 16 November the Workers list was empty, so it is gone. I have not checked whether its failed build shows as a check on pull requests. The Pages project is a new one: in the dashboard, Workers & Pages, Create application, the Pages tab, import the Git repository. **(docs)** Leave the root directory empty.

## The order

| # | Who | Step | State, 16 November 2026 |
| --- | --- | --- | --- |
| 1 | You | Create the Pages project (not a Worker). Connect the repo. Output folder `public`, no build command. Deploy a preview. | Done. Checked: project `race-day-tools`, GitHub source, production branch `main`, output folder `public`, no build command, domain `race.trimomentum.com`. |
| 2 | You | Open the Resend account. Create a send-only key. Check its data retention against "We don't keep it". | The account and key exist: a commit says the send works. The retention check is not recorded. |
| 3 | You | Choose the sending domain. Use a subdomain. | Done. Checked: `mail.trimomentum.com`. |
| 4 | You | Add SPF, DKIM and DMARC records. Wait for Resend to show the domain verified. | Partly. Checked: a DKIM key and Resend's two CNAMEs are there. DMARC is `p=none`. No SPF TXT record is in the zone, and whether the CNAME covers it is not checked. Resend's verified status is not checked. |
| 5 | You | Add `RESEND_API_KEY` and `MAIL_FROM` as **secrets**, preview first. | Done. Checked: production holds both names, preview holds none. Values not read. |
| 6 | You | Add a Cloudflare rate-limiting rule on POST `/api/send`. | Done. Checked: "Limit email sends" blocks an IP for 10 seconds after more than 5 POSTs in 10 seconds. |
| 7 | You | Set a Resend usage alert or cap. | Not recorded. |
| 8 | Agent | Check the Resend request shape in `functions/api/send.js` against Resend's docs. | Not checked against the docs. A real send works. |
| 9 | Agent | This branch: the docs, ready for the cut-over. | Done. |
| 10 | You, then agent | Check the preview (below). | Partly. A real send found the `redirect` bug, fixed the same day. The live pages carry the full header set, and `/api/send` answers a GET with 405 and `Allow: POST` (checked). The other boxes are not recorded. |
| 11 | You | Move DNS. Keep GitHub Pages live until the new address is checked. Then retire `pages.yml`. | Open. The Cloudflare address works. The GitHub Pages copy still publishes, and `pages.yml` is still here. |
| extra | You | Require the `unit` check on `main` in GitHub, with a branch protection rule or a ruleset. On 16 November 2026 `main` had neither. Do it before step 11. | Not checked. The set-up session reported it required; this repo cannot show it. |

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

## What changes in the repo at cut-over (step 11)

One small pull request, after step 10 passes:

- README, Hosting section: the new address, and what you set up by hand.
- CONTRIBUTING, "Branches and pull requests": the line "Merging to `main` deploys to https://jthoyer.github.io/race-day-tools/ ... once `npm test` passes". Write what is true for the deploy path you chose.
- Delete `.github/workflows/pages.yml`.
- No change to `canEmailHere`. GitHub Pages stays a host without the function.
- No change to the content policy. It stays `connect-src 'self'`.

## Roll back

Keep GitHub Pages live until the new address is checked. To go back, point DNS at GitHub Pages again. The email block and the feedback footer hide themselves there.

## Still blocks launch

The move is not the launch. Do not announce email while RD-005 (ranges still `UNCHECKED`), RD-034 or RD-040 is open.
