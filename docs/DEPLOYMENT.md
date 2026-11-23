# Deploying PIMS to Cloudflare

PIMS is one Worker (API + static React app) plus one D1 database. The free plan is enough for a single intern. Nothing here is automated by the repository — you run these commands with your own Cloudflare account.

## Prerequisites

- A Cloudflare account and Node 20+.
- `npm install` has been run in the project root.
- Log in once: `npx wrangler login`.

## 1. Create the D1 database

```bash
npx wrangler d1 create pims-db
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing the all-zero placeholder:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "pims-db", "database_id": "<paste-id-here>", "migrations_dir": "migrations" }
]
```

(Keep the binding name `DB` — the code uses it.)

## 2. Apply the migrations

```bash
npm run db:migrate:remote
```

This runs `migrations/0001`–`0004` against the remote database. Re-run it after pulling any future migration; applied ones are skipped.

## 3. Set the setup-key secret

The first account can be created by whoever reaches the site first, so lock it:

```bash
npx wrangler secret put SETUP_KEY
```

Choose a long random value. You will type it once on the first-run screen. (If you skip this, anyone who opens the URL before you can create the account.)

## 4. Build and deploy

```bash
npm run deploy        # = npm run build && wrangler deploy
```

Wrangler prints the URL, e.g. `https://pims.<your-subdomain>.workers.dev`. Open it, complete the setup form, and you are in. The two seed tasks are created at that moment.

`wrangler.jsonc` already routes `/api/*` to the Worker first and serves everything else from `web/dist` as a single-page app, so deep links such as `/reports` and share links `/r/<token>` work on refresh.

## 5. Optional: custom domain

Add the domain in the Cloudflare dashboard (Workers & Pages → pims → Settings → Domains & Routes), or add a `routes` entry to `wrangler.jsonc`. Then add the new origin to `ALLOWED_ORIGINS` only if you also serve the app from a *different* origin than the Worker handling `/api`. For the normal single-hostname setup nothing else is needed.

## 6. Optional: R2 for PDF copies

PDFs are always generated in the browser. With R2 enabled, every exported PDF is also stored and the report records that it has one.

```bash
npx wrangler r2 bucket create pims-attachments
```

Uncomment in `wrangler.jsonc`:

```jsonc
"r2_buckets": [ { "binding": "ATTACHMENTS", "bucket_name": "pims-attachments" } ],
```

Redeploy. Settings → Security & data shows "PDF storage (R2): enabled".

## Environment variables and bindings

| Name | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `DB` | D1 binding | — | **Required.** Database `pims-db`. |
| `ASSETS` | Assets binding | — | **Required.** Created from the `assets` block (the built web app). |
| `ATTACHMENTS` | R2 binding | off | Optional PDF storage. Absent = feature disabled; the API answers `501` for the PDF endpoints. |
| `SETUP_KEY` | **Secret** | unset | Required to create the first account when set. Strongly recommended. Set with `wrangler secret put` (production) or `.dev.vars` (local). |
| `APP_NAME` | var | `PIMS` | Name shown by `/api/health` and Settings. |
| `SESSION_TTL_DAYS` | var | `30` | Session lifetime; renewed while you use the app. |
| `ALLOWED_ORIGINS` | var | empty | Comma-separated extra origins allowed to make cookie-authenticated writes (CSRF allow-list). The Worker's own origin is always allowed. |

Local development reads secrets from `.dev.vars` (see `.dev.vars.example`). Never commit `.dev.vars` — it is git-ignored.

## Updating

```bash
git pull
npm install
npm run db:migrate:remote     # only does something if there are new migrations
npm run deploy
```

Existing data is untouched; migrations are additive.

## Backups

- **From the app:** Settings → Security & data → *Full backup (JSON)* (all your records) or *Tasks (CSV)*.
- **From Cloudflare:** `npx wrangler d1 export pims-db --remote --output pims-backup.sql`. D1 also keeps Time Travel history for point-in-time restore: `npx wrangler d1 time-travel info pims-db`.

To restore a SQL export into a fresh database: `npx wrangler d1 execute pims-db --remote --file pims-backup.sql`.

## Team Lead access

In the app, Settings → Team Lead → create an account (name, email, temporary password). Send those credentials to your mentor; they sign in at the same URL and see only submitted reports. You can also send them a report's **share link** (a read-only page, no login) from the Reports page after submitting.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Cross-origin request blocked` (403) on login or saves | The page's origin is not the Worker's origin. Use the Worker URL, or add the origin to `ALLOWED_ORIGINS`. |
| First-run screen asks for a setup key you don't have | `SETUP_KEY` is set as a secret. Use that value, or change it with `wrangler secret put SETUP_KEY`. |
| `D1_ERROR: no such table` | Migrations weren't applied to *this* database. Run `npm run db:migrate:remote` (or `db:migrate:local` for local). |
| Blank page after deploy | `npm run build` didn't run, so `web/dist` is missing. Use `npm run deploy`, which builds first. |
| Webhook returns 401 | Missing `Bearer` prefix, wrong token, or the token was revoked. Create a new one in Settings → Automation. |
| Times look 6 hours off in custom tools | Webhook timestamps without an offset are read as Dhaka time; send ISO-8601 with an offset or epoch seconds to be explicit. |
| Local tests fail on "setup" | The local database already has an account. Point `--persist-to` at a fresh directory. |
