# DOM — Daily Operations Manager

A working, single-user internship tracker for one intern and one mentor (Team Lead): tasks, attendance, development log, and a daily report that can be submitted to the Team Lead for review. It runs entirely on Cloudflare: **one Worker** serves the React app and the REST API, and **D1** (SQLite) stores everything. R2 is optional.

Timezone is fixed to **Asia/Dhaka (UTC+6)**. Timestamps are stored in UTC and converted for display and for all attendance maths.

## What's in the box

| Module | What it does |
| --- | --- |
| **Dashboard** | Greeting, live Dhaka clock, today's attendance with clock-in/out, task counters, 7-day hours chart, status and category charts, upcoming deadlines, today's report status, pending phone events. |
| **My Tasks** | Spreadsheet-style grid. Click any cell to edit; saves automatically. Search, filter (status / priority / category / date range / overdue), sort by any column, duplicate, soft-delete, quick-add (press `N`), overdue rows highlighted, per-task drawer with notes, blockers and full change history, CSV export. |
| **Attendance** | Office hours 10:00 AM – 7:00 PM (configurable). Late, early-departure, overtime and worked time are calculated from first login to last logout. Early arrival is **not** double-counted as overtime (unless you opt in). Manual correction needs a reason and is written to an audit trail. |
| **Android automation** | Tasker/MacroDroid calls an authenticated webhook on phone unlock/lock. DOM only *suggests* a login/logout; you confirm (or enable auto-confirm). Duplicates are collapsed, every event is stored with its source and reason, and the manual button always works. |
| **Development Log** | Per-day entries by area (frontend, backend, database, API, integration, testing, deployment) with technologies, problems, solutions, status and next plan. Feeds the daily report. |
| **Daily Reports** | Generated from your real tasks, attendance and dev log. Edit everything, preview, copy as formatted text, export PDF, copy a read-only share link, submit to the TL. A submitted version is **locked**; changes go into a new revision. Full history with status per revision. |
| **Team Lead view** | Separate read-only login. Lists submitted reports, opening one marks it *Viewed*, and the TL can comment, mark reviewed, request a revision or approve. |
| **Analytics** | Hours per day, tasks completed per day, status / priority / category breakdowns, time logged per category, punctuality, report counts — for any date range up to a year. |
| **Settings** | Profile, office schedule, working days, automation window, device tokens, TL account, password, JSON backup, theme. |

There is no mock data. A fresh database contains only the two tasks you asked for (created during first-run setup):

1. **Task 01 – Task Management SaaS** (Full-stack Development, High, In Progress)
2. **Task 02 – Cloudflare Deployment with D1** (Deployment, High, Not Started)

## Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS (shadcn-style components on Radix), TanStack Query, React Router, Lucide icons, Recharts (lazy-loaded), jsPDF (loaded on demand), installable PWA, light/dark/system theme.
- **Backend:** Cloudflare Workers, Hono, Zod validation, D1 with SQL migrations, optional R2.
- **Tests:** 17 unit tests for the attendance and timezone maths, 125 API checks against a live Worker, 47 browser end-to-end checks against the real UI.

## Quick start (local)

Requirements: Node 20+ and npm. Python 3 + Pillow only if you want to regenerate the PWA icons.

```bash
npm install
cp .dev.vars.example .dev.vars      # sets SETUP_KEY for local development
npm run db:migrate:local            # creates the local D1 database
npm run build                       # builds the web app into web/dist
npm run preview                     # Worker + built app on http://localhost:8787
```

Open <http://localhost:8787>. The first screen is the one-time account setup; enter the setup key from `.dev.vars`.

For hot-reload development run `npm run dev` instead. It starts the Worker on port 8787 and Vite on **http://localhost:5173** (Vite proxies `/api` to the Worker and rewrites the `Origin` header so the CSRF check passes).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Worker (8787) + Vite dev server (5173) |
| `npm run build` | Production build of the web app |
| `npm run preview` | Build, then serve app + API from the Worker on 8787 |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations locally / to Cloudflare |
| `npm run typecheck` | Type-check Worker and web |
| `npm test` | Unit tests (attendance maths, timezone helpers) |
| `npm run test:api` | 125 API checks against a running Worker (see below) |
| `node scripts/ui-e2e.mjs` | 47 browser checks against a running Worker (needs Playwright) |
| `npm run icons` | Regenerate PWA icons |

### Running the API and UI test suites

Both suites create the first account, so run each against a **fresh** local database:

```bash
mkdir -p /tmp/DOM-test-1
npx wrangler d1 migrations apply DOM-db --local --persist-to /tmp/DOM-test-1
npm run build
npx wrangler dev --port 8787 --persist-to /tmp/DOM-test-1 --var SETUP_KEY:test-setup-key
# in another terminal:
npm run test:api
# stop the Worker, repeat with /tmp/DOM-test-2, then:
node scripts/ui-e2e.mjs            # SHOTS=./shots to save screenshots
```

## Project layout

```
worker/src/        Hono API (routes/, lib/), env bindings
web/src/           React app (pages/, components/, hooks/, lib/)
shared/            Types, enums and the attendance/timezone maths used by both sides
migrations/        D1 schema (0001 core, 0002 tasks, 0003 attendance, 0004 reports)
tests/             Vitest unit tests
scripts/           API smoke test, browser e2e test, icon generator
docs/              API.md, DEPLOYMENT.md
android/           Tasker / MacroDroid setup guide
wrangler.jsonc     Worker + D1 (+ optional R2) configuration
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deploy to Cloudflare, environment variables, secrets, R2, custom domain, backups.
- [docs/API.md](docs/API.md) — every REST endpoint.
- [android/README.md](android/README.md) — Tasker and MacroDroid setup for unlock/lock automation.

## Security notes

- Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers limit), per-user salt.
- Sessions: random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (on HTTPS) cookie; only its SHA-256 is stored; sliding expiry (`SESSION_TTL_DAYS`).
- Login is rate-limited per email and per IP. Changing the password signs out other devices.
- State-changing requests from a browser must come from the app's own origin (or one listed in `ALLOWED_ORIGINS`).
- Device tokens are shown once and stored hashed; they can only call the webhook and can be revoked individually.
- First-run setup is locked behind the `SETUP_KEY` secret and disappears once an account exists.
- CSV exports neutralise spreadsheet-formula injection. API responses are `no-store`; a strict CSP is set in `web/public/_headers`.
- Share links contain a 24-byte random token, work only for submitted reports, and are read-only.

## Known limits

- **PDF text is Latin only.** jsPDF's built-in font can't draw Bengali or other scripts; unsupported characters are written as `?` in the PDF. Copy-as-text and the on-screen report are unaffected. Embedding a Unicode font would lift this.
- Generating a report for a **past** date uses tasks' *current* statuses, not their status on that day.
- Single intern per deployment; the TL account is created from Settings. Multiple interns per TL is supported by the data model but there is no admin UI for it.
- The Android automation is a suggestion mechanism — it cannot prove you were physically in the office.
- Cloudflare deployment is not performed by this repository's tooling; follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) with your own account.
