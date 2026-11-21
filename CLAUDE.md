# CLAUDE.md: Winning Ranch (winningsites)

These notes are shared by Claude Code on the desktop (VS Code, Windows) and Claude Code in the cloud (iPhone).
GitHub is the only shared state, so anything not pushed is invisible to the other side.
`README.md` (in Portuguese) is the operator guide: features, Railway variables, domains. Keep it up to date when behaviour changes.
This file is the developer guide. Do not put secrets, passwords, keys or variable *values* here.

## This is a production app

Owners, ranch staff and the office use it every day, and the data includes signed waivers and encrypted W-9 numbers.
- Make the smallest change that does the job. Don't rewrite working code, rename routes or restructure files without being asked.
- Before editing, find who calls the code (`grep` the routes and the front-end JS).
- Never make destructive data changes, change credentials, or send email or messages to real people without explicit approval.

## Git workflow (required)

1. Before starting a task: `git status`, `git fetch origin`, then compare your branch with `origin/main` and look at other remote branches for related work.
2. Never discard, reset or overwrite uncommitted work without asking.
3. One branch per task, created from the latest `origin/main`. **Never commit or push to `main`.**
4. Run the checks below, review the diff for regressions and security issues, then commit with a plain descriptive message. Existing style: `Area: what changed, in plain words`.
5. Push the branch and open a pull request for review. **Never merge a PR, never force-push, never deploy** without explicit approval.
6. If the remote branch or `main` moves while you work, look at the new commits and merge them in carefully. Explain conflicts instead of resolving them blindly.
7. In the report, list the files changed, what was tested and what could not be tested. A push is not proof that it works in production.

## Deployment (unconfirmed, so be careful)

- Hosting is **Railway**. `railway.json` sets `startCommand: npm start`, healthcheck `/healthz` and restart `ON_FAILURE`. Don't change it.
- The repo has **no CI/CD config** (no `.github/`, no Dockerfile or Procfile). Railway builds with its default Node builder.
- `/api/ranch/ops/ping` reports `RAILWAY_GIT_COMMIT_SHA`, so Railway builds from Git. **Whether a push or merge to `main` deploys to production automatically isn't visible in the repo.** Check it in Railway → service → Settings → Source (connected repo, branch, auto-deploy, "wait for CI"). Until confirmed, assume that **merging to `main` = deploying to production**.
- Production needs a Railway Volume at `/data` with `DATA_DIR=/data`. Without it, all data is lost on redeploy.
- Domains: `www.winningranch.com` / `winningranch.com` serve the website (`/` → `home.html`), `app.winningranch.com` and `winningranch.up.railway.app` serve the app. DNS is on Cloudflare.

## Architecture

One Node + Express service with no build step. Node ≥ 20, dependencies: `express`, `multer`, `nodemailer`, `@anthropic-ai/sdk`.

| Path | What it is |
|---|---|
| `server.js` | Serves `public/` as static files (HTML is `no-cache`), mounts the API at `/api/ranch`, `/healthz`, redirects for old paths (`/ranch/*`, `/portal`, `/review`), picks the front page by host name |
| `routes/ranch.js` | Main router (~1,400 lines): store and startup migrations, master accounts, auth, stalls, bookings, people, horses, updates, pricing, waivers/documents, contact, ops API. Mounts the others: |
| `routes/board.js` | Stall board: monthly and nightly stays, Find stalls, assistant tools |
| `routes/shifts.js` | Time clock, checklist, hours, daily/weekly email reports, 6-hour alert |
| `routes/schedule.js` | Weekly AM/PM schedule, usual week, swap requests |
| `routes/chats.js` | In-app chats, mentions, reactions, files, Home data |
| `lib/store.js` | JSON store: `store.data` in memory, `store.save()` writes `ranch.json` atomically (tmp + rename) |
| `lib/auth.js` | scrypt passwords, random session tokens in HttpOnly cookie `wr_session` (stored hashed, 30 days), rate limiting |
| `lib/ranch-seed.js` | Initial stalls, demo owner (`SEED_DEMO=1`), app-store review accounts (password hashes only) |
| `lib/ranch-layout.js` | Map image size and each stall's pixel rectangle/plate |
| `lib/docs.js` | Signable documents and their fields |
| `lib/secret.js` | AES-256-GCM for W-9 SSN/EIN |
| `lib/mailer.js` | Email via Gmail SMTP app password, Gmail API or Resend |
| `lib/stall-ai.js`, `lib/stall-planner.js` | Stall assistant (Anthropic API) and the stall-picking logic it calls, which is plain code |
| `lib/hours.js`, `lib/oplog.js` | Hours maths, in-memory recent log lines for `/ops/logs` |
| `public/index.html`, `public/app/` | The web app (owners and staff), PWA manifest. Store apps wrap this URL with Capacitor |
| `public/admin/`, `public/js/admin*.js` | Dashboard for office / ranch manager |
| `public/*.html`, `public/js/site.js`, `stalls.js`, `sign.js` | Public website, stall map, online signing |
| `public/docs/` | Document text (HTML) next to the original PDFs. **Don't reword legal text.** |
| `tools/ranch-ops.mjs` | CLI for the live ops API (see below) |
| `sites/`, `review/`, `sites.config.json` | **Legacy**: an older copy of the site and a review tool. Not served by `server.js`. Edit `public/`, not `sites/`. |

### Data
- Everything is in `DATA_DIR` (default `./data`, git-ignored): `ranch.json` (stalls, bookings, users, sessions, horses, updates, pricing, waivers, shifts, chats, contacts…), `uploads/`, and `w9.key` when `W9_KEY` is not set.
- Route code only touches `store.data` / `db` and calls `store.save()`. Keep it that way so a later move to Postgres stays simple.
- **Data migrations**: the `migrations` object near the top of `routes/ranch.js`. Each runs once and is recorded in `db.migrations[name]`. Add a new named migration rather than editing an old one, and never overwrite what staff have changed.

### Users and permissions
- `role`: `owner` or `staff`. Staff `position`: `hand`, `manager`, `office` (default), `lessons` (lesson program).
- `master: true` accounts (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, plus the developer account hard-coded in `routes/ranch.js`) can't be disabled or changed by others.
- Ranch hands get a temporary password (`HAND_TEMP_PASSWORD`, with a code default) and must change it on first login.
- There's no public sign-up. Staff create people in the dashboard and an invite email goes out.
- Check permissions on the server for every new route (see the `staff` middleware and the role/position checks in the routes). Owners must only see their own horses, chats and documents.

## Critical areas (extra care, explain before changing)

- **Login and sessions** (`lib/auth.js`, login routes, master-account setup).
- **`lib/secret.js` / W-9.** Changing or losing the key (env `W9_KEY` or `DATA_DIR/w9.key`) makes stored numbers unreadable. Never log or return decrypted numbers.
- **Signed waivers.** Each signature stores the exact document version. Don't change document text or fields in a way that alters past signatures.
- **Startup migrations and seeds.** They run against production data on every deploy.
- **The ops API** (`X-Ops-Key` → acts as the master account or `OPS_ACT_AS`). Responses must never include passwords, tokens or invite links.
- **Email** (`lib/mailer.js`, invites, "Invite everyone", reports, 6-hour alert). Code that sends to real people needs approval to run.
- **Uploads.** Stall photos are public; everything else must stay behind access checks.

## Run and test locally

There are no automated tests and no linter. Minimum checks before a commit:

```bash
npm ci
for f in server.js lib/*.js routes/*.js public/js/*.js public/app/app.js; do node --check "$f" || echo "FAIL $f"; done
DATA_DIR=/tmp/wr-data PORT=3999 npm start      # throwaway data dir, never a copy of production
curl -s localhost:3999/healthz                  # {"ok":true}
```

- Then open or curl the pages and API routes you touched. For UI changes, Chromium + Playwright are available in cloud sessions for screenshots.
- With no email variables set, nothing is sent (invite links are logged instead). Without `ANTHROPIC_API_KEY` the stall assistant is off and the rest works.
- A fresh data dir seeds the stalls, the developer master account and the review accounts. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` locally to get a staff login you can use.
- `npm run dev` restarts on file changes.

## Environment variables (names only, values live in Railway)

| Purpose | Variables |
|---|---|
| Core | `PORT`, `DATA_DIR`, `APP_BASE_URL` (links in emails, else `RAILWAY_PUBLIC_DOMAIN`) |
| Accounts | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_EMAILS` (`email:Name,…`), `HAND_TEMP_PASSWORD`, `SEED_DEMO` (test only) |
| Email | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME` · or Gmail API `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` · or `RESEND_API_KEY`, `EMAIL_FROM`, `REPORT_FROM`, `EMAIL_FROM_NAME` |
| Integrations | `ANTHROPIC_API_KEY` (stall assistant), `BOOKING_WEBHOOK_URL`, `CONTACT_WEBHOOK_URL`, `REPORT_WEBHOOK_URL` (Zapier/integrator.io), `APP_STORE_URL`, `PLAY_STORE_URL` |
| Security | `W9_KEY` (32 bytes base64), `OPS_API_KEY`, `OPS_ACT_AS` |
| Provided by Railway | `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_GIT_COMMIT_SHA` |
| `tools/ranch-ops.mjs` (client side) | `RANCH_OPS_KEY` or file `~/.winningranch-ops-key`, `RANCH_BASE` (default production) |

`REVIEW_PASSWORD` is no longer used. Never commit `.env` (it is git-ignored).

## Ops API (live production)

`node tools/ranch-ops.mjs /ops/ping` talks to the **live** server as the master account. Use it only when asked, read-only by default. Any write (POST/PATCH/DELETE, invites, test emails) needs explicit approval. Cloud sessions don't have the key unless it is added as an environment secret. On Git Bash use `MSYS_NO_PATHCONV=1`.

## Conventions

- Plain browser JavaScript, HTML and CSS: no framework, bundler or TypeScript. Server is CommonJS (`require`).
- Code comments explain *why* in short sentences. UI text is plain English for ranch staff.
- Keep files and patterns as they are: new API routes go in the matching `routes/*.js`, shared logic in `lib/`.
- Dates are `YYYY-MM-DD` strings. IDs are random hex (`crypto.randomBytes`).
- Binary files are marked in `.gitattributes` (Windows checkouts use autocrlf). Add new binary types there.
- When a feature changes, update `README.md` (Portuguese) and, if it affects development, this file.

## Known limits

- No tests and no CI. Changes are checked by hand.
- JSON-file storage, single instance. Don't run two server processes on the same `DATA_DIR`.
- Chats poll every few seconds. No push notifications yet.
- Time-clock location comes from the phone and can be faked.
