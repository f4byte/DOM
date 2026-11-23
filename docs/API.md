# PIMS REST API

Base path: `/api`. JSON in, JSON out. All times are ISO-8601 UTC strings (`2026-11-05T04:00:00.000Z`) unless a field says otherwise; dates are `YYYY-MM-DD` in Asia/Dhaka.

## Conventions

**Authentication.** Browser endpoints use the `pims_session` cookie set by `POST /auth/login` (`HttpOnly`, `SameSite=Lax`). The webhook `POST /device/event` uses `Authorization: Bearer pims_…` instead and never a cookie.

**Roles.** `intern` (all intern endpoints), `tl` (only `/tl/*`, `/auth/*`), `admin` (treated like intern). A TL calling an intern endpoint receives `403`.

**CSRF.** Requests carrying an `Origin` header must match the Worker's own origin or an entry in `ALLOWED_ORIGINS`; otherwise `403 Cross-origin request blocked`. Requests without `Origin` (curl, Tasker) are fine.

**Errors.** Every error is

```json
{ "error": { "code": "validation_error", "message": "Human readable text", "details": [ … ] } }
```

| Status | Typical `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request`, `validation_error` | Invalid input (`details` lists the Zod issues) |
| 401 | `unauthenticated` | No/expired session or bad device token |
| 403 | `forbidden` | Wrong role, bad setup key, blocked origin |
| 404 | `not_found` | Missing or not yours |
| 409 | `conflict`, `report_locked`, `not_latest`, `superseded` | State conflict |
| 429 | `rate_limited` | Too many failed logins |
| 501 | `r2_disabled` | R2 not configured |

Responses are sent with `Cache-Control: no-store`.

---

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ ok, app, time }` — no auth |

## Auth

| Method | Path | Body → Response |
| --- | --- | --- |
| GET | `/auth/status` | → `{ setupRequired, setupKeyRequired, authenticated, user }` |
| POST | `/auth/setup` | `{ fullName, email, password (≥10), mentorName?, setupKey? }` → signs in, creates the two seed tasks. Only works while no user exists; `setupKey` must match the `SETUP_KEY` secret when one is set. |
| POST | `/auth/login` | `{ email, password }` → `{ user }` + cookie. 8 failures/identifier or 25/IP per window → 429. |
| POST | `/auth/logout` | → `{ ok: true }` |
| GET | `/auth/me` | → `{ user }` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword (≥10) }` → signs out all other sessions |

## Tasks

`TaskDTO`: `id, code ("TSK-0001"), title, description, category, assignedDate, startTime, deadline, priority, status, estimatedMinutes, actualMinutes, progressPercent, implementationNotes, blockers, completedAt, referenceUrl, createdAt, updatedAt, isOverdue`.

Enums — `category`: Frontend Development, Backend Development, Full-stack Development, Database Management, API Integration, Bug Fixing, Testing & Debugging, Deployment, Research & Learning, Documentation, Other. `status`: Not Started, In Progress, Under Review, Completed, On Hold, Blocked. `priority`: Low, Medium, High, Urgent.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tasks` | Query: `q` (title/description/notes/code), `status`, `category`, `priority` (comma-separated), `date`, `from`, `to` (assigned date), `overdue=1`, `sort` (`code,title,category,assignedDate,startTime,deadline,priority,status,estimatedMinutes,actualMinutes,progressPercent,completedAt,updatedAt,createdAt`), `dir=asc\|desc`, `limit` (≤2000). → `{ tasks, total }` |
| POST | `/tasks` | Only `title` is required; other fields default. → `201 { task }` |
| GET | `/tasks/:id` | → `{ task, activity[] }` (change history, newest first) |
| PATCH | `/tasks/:id` | Any subset of the writable fields. Setting `status: "Completed"` also sets `completedAt` (now) and `progressPercent: 100` unless you send them; moving to In Progress sets `startTime` if empty. Each changed field is logged. |
| DELETE | `/tasks/:id` | Soft delete (kept for history/backup) |
| POST | `/tasks/:id/duplicate` | → `201 { task }` (status Not Started, progress 0) |

Date-time fields (`startTime`, `deadline`, `completedAt`) must be full ISO strings with offset, or `null`.

## Attendance

`AttendanceDTO`: `id, workDate, firstLoginAt, lastLogoutAt, lateMinutes, earlyArrivalMinutes, earlyDepartureMinutes, overtimeMinutes, workedMinutes, standardMinutes, remainingMinutes, shortfallMinutes, status, statusManual, loginSource, logoutSource, notes`.

`status`: present, late, early_leave, late_early_leave, overtime, in_progress, missing_logout, leave, holiday, absent.

Calculation (default 10:00–19:00, 0 grace, 0 break): `late = login − 10:00` when that exceeds the grace period (arriving 15 min late with a 10 min grace counts as 15 late; arriving 8 min late counts as 0); `earlyDeparture = max(0, 19:00 − logout)`; `overtime = max(0, logout − 19:00)`; early arrival is recorded in `earlyArrivalMinutes` and counts toward worked time but is **not** added to overtime unless `countEarlyArrivalAsOvertime` is on. Seconds are ignored.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/attendance/today` | → `{ date, attendance, pendingEvents[], automationEnabled, schedule }` |
| GET | `/attendance?month=YYYY-MM` | → `{ month, days[], summary, schedule }`. Each day: `{ date, weekday, isWorkingDay, placeholder, record }`; `placeholder` is `absent`, `weekend`, `future`, `before_start` or null. |
| POST | `/attendance/clock-in` | Optional `{ note }`. Always uses the **server clock**. → `{ changed, attendance }` (a second call the same day changes nothing) |
| POST | `/attendance/clock-out` | Updates last logout to now. → `{ changed, attendance }` |
| PUT | `/attendance/:date` | Manual correction. Body: `{ firstLoginAt?, lastLogoutAt?, status? ("leave"\|"holiday"\|"absent"\|null), notes?, reason (required, 3–500 chars) }`. At least one change. Future dates rejected. Every change is audited. |
| GET | `/attendance/events` | `?status=pending`, `?includeIgnored=1`, `?limit` → `{ events[] }` |
| POST | `/attendance/events/:id/confirm` | Optional `{ action: "login"\|"logout" }` to override the suggestion → `{ attendance, pendingEvents }` |
| POST | `/attendance/events/:id/reject` | → `{ ok, pendingEvents }` |
| GET | `/attendance/audit` | `?date`, `?limit` → `{ audit[] }` (field, old/new value, reason, source) |

## Device webhook (Android automation)

`POST /device/event` — header `Authorization: Bearer <device token>`, `Content-Type: application/json` (form-encoded also accepted).

```json
{ "event": "unlock", "timestamp": "2026-11-05T09:58:00+06:00", "device": "Pixel 7" }
```

- `event`: `unlock` or `lock` (required).
- `timestamp` (optional): ISO-8601, `YYYY-MM-DD HH:MM` (read as Dhaka time), or epoch seconds/milliseconds. Defaults to server time. Must be ≤ 7 days old and ≤ 10 minutes in the future.
- `device` (optional): free-text label.

Response `200`: `{ ok: true, accepted, status, reason?, eventId?, suggestedAction?, autoConfirmed? }` where `status` is `pending`, `confirmed` (auto-confirm on), `ignored` or `duplicate`.

Decision rules:

| Event | Becomes a pending suggestion when… | Otherwise ignored with reason |
| --- | --- | --- |
| `unlock` | no login yet that day, it is a working day, local time is inside the login window (default 06:00–13:00), and no login suggestion is already pending | `already_logged_in_today`, `non_working_day`, `outside_login_window`, `login_already_suggested` |
| `lock` | a login exists, local time is after `logoutSuggestAfter` (default 16:00), and it is later than any recorded logout. The latest lock supersedes earlier pending ones. | `no_login_today`, `before_logout_window`, `older_than_recorded_logout` |

Two identical events within ±59 s are `duplicate`. If automation is disabled in Settings the call returns `{ ok: true, accepted: false, status: "ignored", reason: "automation_disabled" }`. `401` for a missing, unknown or revoked token.

Token management (session auth, intern only):

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/device/tokens` | → `{ tokens[] }` (prefix only) |
| POST | `/device/tokens` | `{ label }` → `201 { id, label, token }` — **the raw token is returned once**. Max 10 active. |
| DELETE | `/device/tokens/:id` | Revoke |

## Development log

`DevLogDTO`: `id, logDate, area, taskId, taskCode, taskTitle, implemented, technologies, problems, solutions, status, nextPlan, createdAt, updatedAt`. `area`: Frontend Implementation, Backend Implementation, Database Implementation, API Development, Integration, Testing, Deployment.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/devlogs` | `?date`, `?from`, `?to` → `{ logs[] }` |
| GET | `/devlogs/summary?date=` | → `{ date, totalEntries, byArea[], technologies[], problems[], nextSteps[] }` |
| POST | `/devlogs` | `logDate` and `area` required; optional `taskId` (must be your task) → `201 { log }` |
| PATCH | `/devlogs/:id` | Any subset |
| DELETE | `/devlogs/:id` | |

## Daily reports

`ReportDTO`: `id, reportDate, revision, status, locked, header, content, shareToken, submittedAt, viewedAt, reviewedAt, hasPdf, createdAt, updatedAt, reviews?`.
`status`: draft → submitted → viewed → reviewed / revision_requested / approved. Only `draft` is editable.
`content`: `{ summary, completed[], inProgress[], pending[], technical{frontend,backend,database,api,testing,deployment,other: string[]}, challenges[{problem,solution}], nextPlan[] }`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/reports` | All reports and revisions, newest first |
| GET | `/reports/by-date/:date` | Latest revision for a date → `{ report \| null }` |
| POST | `/reports/generate` | `{ date, regenerate? }`. Builds a draft from tasks, attendance and dev logs. Returns the existing draft unless `regenerate` is true (which overwrites it). `409 report_locked` if the date's latest revision is submitted. |
| GET | `/reports/:id` | With `reviews[]` |
| PUT | `/reports/:id` | `{ content }` — draft only (`409 report_locked` otherwise) |
| POST | `/reports/:id/refresh-header` | Re-reads attendance/profile into a draft's header |
| POST | `/reports/:id/submit` | Locks this revision. Empty reports are rejected. Exporting/copying never submits. |
| POST | `/reports/:id/revise` | From a submitted report: creates revision N+1 as a draft (copy of the content). Only from the latest revision. |
| DELETE | `/reports/:id` | Drafts only |
| POST | `/reports/:id/pdf` | Raw `application/pdf` body (≤ 8 MB, must start with `%PDF-`). Needs the R2 binding, else `501`. |
| GET | `/reports/:id/pdf` | Download the stored PDF (R2) |

### Public share link

`GET /public/reports/:token` — no auth. Only submitted (non-draft) reports. → `{ report, reviews, latest }` where `latest` is `{ revision, token, status }` of a newer revision if one exists. Opening it as anyone other than the author marks the report **viewed**. The response carries `X-Robots-Tag: noindex`.

## Team Lead (role `tl`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tl/reports` | `?status=` → `{ reports[] }` of the TL's mentees (submitted only) |
| GET | `/tl/reports/:id` | Marks viewed → `{ report, latest }` |
| POST | `/tl/reports/:id/review` | `{ action: "comment"\|"reviewed"\|"revision_requested"\|"approved", comment? }`. A comment is required for `comment` and `revision_requested`. `409 superseded` when a newer revision exists. |

## Dashboard & analytics

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/dashboard` | Today's attendance, task counters, status/category counts, 7-day trend, upcoming deadlines, today's report |
| GET | `/analytics?from=&to=` | Default last 30 days; max 366 days. Attendance totals/days, task breakdowns, completed-on-time vs late, report counts |

## Settings & profile

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/settings` | → `{ profile, settings, tl, deviceTokens, meta }` |
| PUT | `/settings` | `{ profile?: {fullName, mentorName, employmentType}, settings?: {officeStart, officeEnd, unpaidBreakMinutes, graceMinutes, countEarlyArrivalAsOvertime, workingDays[0-6], automationEnabled, autoConfirmDeviceEvents, loginWindowStart, loginWindowEnd, logoutSuggestAfter} }` |
| POST | `/settings/tl` | `{ name, email, password }` — creates a read-only TL login linked to you |
| DELETE | `/settings/tl` | Unlink (disables the TL login if they mentor nobody else) |

## Export

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/export` | Full JSON backup of your profile, settings, tasks (including soft-deleted ones, with their change history), attendance (+events, audit), dev logs, reports and reviews. Never includes password hashes, sessions or device tokens. |
| GET | `/export/tasks.csv` | UTF-8 CSV with BOM; cells starting with `= + - @` are neutralised |
