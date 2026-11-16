# Host move: GitHub Pages to Cloudflare Pages

**Status: not started.** This is step 5 of the RD-039 plan. Nothing here has been done. GitHub Pages is still the live host.

An agent can edit this repo. Only you can touch Cloudflare, DNS, the mail account and GitHub settings (see AGENTS.md and CONTRIBUTING.md). Each step below is a row in the Notion product backlog, "Host move 1 of 11" to "11 of 11", under RD-039.

What I read in Cloudflare's docs on 16 November 2026 is marked **(docs)**. Anything not marked is not checked.

## Decide first: how Cloudflare deploys

**Git integration** (the plan's choice). Cloudflare watches the repo and deploys on every push to the production branch. **(docs)** It does not wait for GitHub Actions. So "merging deploys once `npm test` passes" stops being true. A project made this way cannot switch to Direct Upload later. **(docs)**

To keep the test gate, turn on branch protection for `main` in GitHub and require the `unit` check from `.github/workflows/test.yml`. That workflow runs on every pull request. You set this by hand.

**Direct Upload from Actions** keeps the gate inside the workflow: run `npm test`, then `wrangler pages deploy public`. It needs a Cloudflare API token stored as a GitHub secret, and more set-up. Not planned.

Pick one before step 1.

## The order

| # | Who | Step |
| --- | --- | --- |
| 1 | You | Create the Pages project. Connect the repo. Output folder `public`, no build command. Deploy a preview. |
| 2 | You | Open the Resend account. Create a send-only key. Check its data retention against "We don't keep it". |
| 3 | You | Choose the sending domain. Use a subdomain. |
| 4 | You | Add SPF, DKIM and DMARC records. Wait for Resend to show the domain verified. |
| 5 | You | Add `RESEND_API_KEY` and `MAIL_FROM` as **secrets**, preview first. |
| 6 | You | Add a Cloudflare rate-limiting rule on POST `/api/send`. |
| 7 | You | Set a Resend usage alert or cap. |
| 8 | Agent | Check the Resend request shape in `functions/api/send.js` against Resend's docs. |
| 9 | Agent | This branch: the docs, ready for the cut-over. |
| 10 | You, then agent | Check the preview (below). |
| 11 | You | Move DNS. Keep GitHub Pages live until the new address is checked. Then retire `pages.yml`. |

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

## What changes in the repo at cut-over (step 11)

One small pull request, after step 10 passes:

- README, Hosting section: the new address, and what you set up by hand.
- CONTRIBUTING, "Branches and pull requests": the line "Merging to `main` deploys to https://jthoyer.github.io/race-day-tools/ ... once `npm test` passes". Write what is true for the deploy path you chose.
- Delete `.github/workflows/pages.yml`.
- No change to `canEmailHere`. GitHub Pages stays a host without the function.
- No change to the content policy. It stays `connect-src 'self'`.

## Roll back

Keep GitHub Pages live until the new address is checked. To go back, point DNS at GitHub Pages again. The email block hides itself there.

## Still blocks launch

The move is not the launch. Do not announce email while RD-005 (ranges still `UNCHECKED`), RD-034 or RD-040 is open.
