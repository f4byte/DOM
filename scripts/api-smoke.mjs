// End-to-end API smoke test. Run against a *fresh local* Worker:
//   npx wrangler dev --port 8787 --persist-to /tmp/pims-test-state --var SETUP_KEY:test-setup-key
//   BASE=http://127.0.0.1:8787 SETUP_KEY=test-setup-key node scripts/api-smoke.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const SETUP_KEY = process.env.SETUP_KEY ?? "test-setup-key";
const PASSWORD = "correct-horse-battery";

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? "  → " + JSON.stringify(extra) : ""}`);
  }
}
const section = (t) => console.log(`\n${t}`);

class Client {
  cookie = "";
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      if (pair.startsWith("pims_session=")) this.cookie = pair.endsWith("=") ? "" : pair;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p, h) => this.req("GET", p, undefined, h);
  post = (p, b = {}, h) => this.req("POST", p, b, h);
  put = (p, b, h) => this.req("PUT", p, b, h);
  patch = (p, b, h) => this.req("PATCH", p, b, h);
  del = (p, h) => this.req("DELETE", p, undefined, h);
}

// ---- Dhaka (UTC+6) time helpers ----
const dhakaDate = (d = new Date()) => new Date(d.getTime() + 6 * 3600e3).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const dow = (date) => new Date(date + "T00:00:00Z").getUTCDay();
const at = (date, hhmm) => `${date}T${hhmm}:00+06:00`;
const utc = (date, hhmm) => new Date(at(date, hhmm)).toISOString();
const today = dhakaDate();

const me = new Client();
const tlc = new Client();

async function main() {
  section("Health & auth guards");
  let r = await me.get("/api/health");
  check("health endpoint is public", r.status === 200 && r.json.ok === true);
  r = await me.get("/api/tasks");
  check("tasks require authentication (401)", r.status === 401);
  r = await me.get("/api/nope");
  check("unknown API route → 404 JSON", r.status === 404 && r.json?.error?.code === "not_found");
  r = await me.get("/api/auth/status");
  check("fresh database reports setupRequired", r.json.setupRequired === true && r.json.setupKeyRequired === true);

  section("First-run setup");
  r = await me.post("/api/auth/setup", { fullName: "Hasibur Rahman", email: "hasib@example.com", password: PASSWORD, mentorName: "xyz", setupKey: "wrong" });
  check("wrong setup key rejected (403)", r.status === 403);
  r = await me.post("/api/auth/setup", { fullName: "Hasibur Rahman", email: "hasib@example.com", password: "short", setupKey: SETUP_KEY });
  check("weak password rejected (400)", r.status === 400);
  r = await me.post("/api/auth/setup", { fullName: "Hasibur Rahman", email: "hasib@example.com", password: PASSWORD, mentorName: "xyz", setupKey: SETUP_KEY });
  check("setup creates account (201) and session cookie", r.status === 201 && !!me.cookie, r.json);
  r = await me.post("/api/auth/setup", { fullName: "Mallory", email: "m@example.com", password: PASSWORD, setupKey: SETUP_KEY });
  check("second setup is refused (403)", r.status === 403);
  r = await me.get("/api/auth/me");
  check("session works", r.status === 200 && r.json.user.fullName === "Hasibur Rahman");

  section("CSRF / origin protection");
  r = await me.post("/api/tasks", { title: "evil" }, { Origin: "https://evil.example" });
  check("cross-origin mutation blocked (403)", r.status === 403);

  section("Seeded tasks");
  r = await me.get("/api/tasks");
  const seeded = r.json.tasks;
  check("two initial tasks exist", seeded.length === 2);
  const t1 = seeded.find((t) => t.code === "TSK-0001");
  const t2 = seeded.find((t) => t.code === "TSK-0002");
  check("Task 01: Task Management SaaS / High / In Progress", t1?.title === "Task Management SaaS" && t1.priority === "High" && t1.status === "In Progress" && !!t1.startTime);
  check("Task 02: Cloudflare Deployment / High / Not Started", t2?.title.startsWith("Cloudflare Deployment") && t2.priority === "High" && t2.status === "Not Started");

  section("Task CRUD, status rules, history");
  r = await me.post("/api/tasks", { title: "Build login form", category: "Frontend Development", priority: "Urgent", assignedDate: today, description: "Login UI", deadline: utc(today, "17:00"), estimatedMinutes: 90 });
  check("create task (201) with auto ID", r.status === 201 && r.json.task.code === "TSK-0003", r.json);
  const tid = r.json.task.id;
  r = await me.post("/api/tasks", { title: "bad", category: "Nonsense" });
  check("invalid category rejected (400)", r.status === 400);
  r = await me.post("/api/tasks", { title: "bad url", referenceUrl: "javascript:alert(1)" });
  check("non-http reference URL rejected", r.status === 400);
  r = await me.patch(`/api/tasks/${tid}`, { status: "Completed" });
  check("completing sets completedAt + 100%", r.json.task.status === "Completed" && !!r.json.task.completedAt && r.json.task.progressPercent === 100);
  r = await me.patch(`/api/tasks/${tid}`, { status: "In Progress", actualMinutes: 45, implementationNotes: "Added validation" });
  check("re-opening clears completedAt", r.json.task.completedAt === null && r.json.task.actualMinutes === 45);
  r = await me.get(`/api/tasks/${tid}`);
  const fields = r.json.activity.map((a) => `${a.action}:${a.field}`);
  check("history preserved (created, status changes, notes)", fields.includes("created:null") && fields.filter((f) => f === "status_changed:status").length === 2 && fields.includes("updated:implementation_notes"), fields);
  r = await me.post(`/api/tasks/${tid}/duplicate`);
  check("duplicate creates a Not Started copy", r.status === 201 && r.json.task.status === "Not Started" && r.json.task.title.endsWith("(copy)"));
  const dupId = r.json.task.id;
  r = await me.del(`/api/tasks/${dupId}`);
  check("delete task", r.status === 200);
  r = await me.get(`/api/tasks/${dupId}`);
  check("deleted task is gone (404)", r.status === 404);
  await me.post("/api/tasks", { title: "Fix 100% CPU_spike bug", category: "Bug Fixing", priority: "Low" });
  r = await me.get("/api/tasks?q=" + encodeURIComponent("100%"));
  check("search treats % literally", r.json.tasks.length === 1 && r.json.tasks[0].title.includes("100%"));
  r = await me.get("/api/tasks?category=Frontend%20Development&status=In%20Progress");
  check("filter by category + status", r.json.tasks.length === 1 && r.json.tasks[0].id === tid);
  r = await me.get("/api/tasks?sort=priority&dir=desc");
  check("sort by priority desc puts Urgent first", r.json.tasks[0].priority === "Urgent");
  r = await me.get("/api/tasks?sort=title;DROP%20TABLE%20tasks");
  check("unknown sort column ignored safely", r.status === 200);
  r = await me.post("/api/tasks", { title: "Overdue thing", deadline: utc(addDays(today, -2), "10:00") });
  const overdueId = r.json.task.id;
  r = await me.get("/api/tasks?overdue=1");
  check("overdue filter + flag", r.json.tasks.some((t) => t.id === overdueId && t.isOverdue));
  await me.post("/api/tasks", { title: '=HYPERLINK("http://x")' });

  section("Attendance — spec examples via audited corrections");
  const [d1, d2, d3, d4, d5, w] = [1, 2, 3, 4, 5, 6].map((n) => addDays(today, -n));
  const fix = (d, i, o) => me.put(`/api/attendance/${d}`, { firstLoginAt: utc(d, i), lastLogoutAt: utc(d, o), reason: "Smoke test" });
  r = await fix(d1, "09:45", "19:30");
  check("9:45→19:30: early arrival 15m, overtime 30m, not late", r.json.attendance.earlyArrivalMinutes === 15 && r.json.attendance.overtimeMinutes === 30 && r.json.attendance.lateMinutes === 0 && r.json.attendance.status === "overtime", r.json);
  r = await fix(d2, "10:30", "18:30");
  check("10:30→18:30: late 30m, early departure 30m", r.json.attendance.lateMinutes === 30 && r.json.attendance.earlyDepartureMinutes === 30 && r.json.attendance.status === "late_early_leave", r.json);
  r = await fix(d3, "10:00", "20:00");
  check("10:00→20:00: overtime 1h, worked 10h", r.json.attendance.overtimeMinutes === 60 && r.json.attendance.workedMinutes === 600);
  r = await fix(d4, "10:00", "19:00");
  check("10:00→19:00: regular, worked 9h", r.json.attendance.status === "present" && r.json.attendance.workedMinutes === 540 && r.json.attendance.overtimeMinutes === 0);
  r = await me.put(`/api/attendance/${d4}`, { lastLogoutAt: utc(d4, "18:00") });
  check("correction without a reason rejected", r.status === 400);
  r = await me.put(`/api/attendance/${d4}`, { lastLogoutAt: utc(d4, "09:00"), reason: "oops" });
  check("logout before login rejected", r.status === 400);
  r = await me.put(`/api/attendance/${addDays(today, 3)}`, { firstLoginAt: utc(addDays(today, 3), "10:00"), reason: "future" });
  check("future date rejected", r.status === 400);
  r = await me.put(`/api/attendance/${d4}`, { lastLogoutAt: utc(d4, "18:15"), reason: "Left early, approved" });
  check("correction recalculates (early departure 45m)", r.json.attendance.earlyDepartureMinutes === 45 && r.json.attendance.logoutSource === "manual");
  r = await me.get(`/api/attendance/audit?date=${d4}`);
  const corr = r.json.audit.find((a) => a.action === "manual_correction" && a.field === "last_logout_at");
  check("audit trail records old/new value and reason", !!corr && corr.reason === "Left early, approved" && corr.oldValue === utc(d4, "19:00") && corr.newValue === utc(d4, "18:15"), corr);
  r = await me.put(`/api/attendance/${d5}`, { status: "leave", reason: "Sick leave" });
  check("manual leave status", r.json.attendance.status === "leave" && r.json.attendance.workedMinutes === 0);

  section("Manual clock in / out");
  r = await me.post("/api/attendance/clock-out");
  check("clock-out without login → 409", r.status === 409 && r.json.error.code === "no_login");
  r = await me.post("/api/attendance/clock-in");
  check("clock-in creates today's record (source manual)", r.status === 200 && r.json.changed === true && r.json.attendance.loginSource === "manual" && r.json.attendance.workDate === today);
  r = await me.post("/api/attendance/clock-in");
  check("second clock-in is a no-op (no duplicate record)", r.json.changed === false);
  await new Promise((res) => setTimeout(res, 1100));
  r = await me.post("/api/attendance/clock-out");
  check("clock-out records logout", r.status === 200 && r.json.attendance.lastLogoutAt !== null);
  r = await me.get(`/api/attendance?month=${today.slice(0, 7)}`);
  check("exactly one attendance row for today", r.json.days.filter((d) => d.date === today && d.record).length === 1);
  check("month summary counts today as attended", r.json.summary.daysPresent >= 1);
  r = await me.get("/api/attendance/today");
  check("today endpoint", r.json.date === today && !!r.json.attendance.firstLoginAt);

  section("Device automation webhook");
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  r = await me.put("/api/settings", { settings: { workingDays: allDays, loginWindowStart: "06:00", loginWindowEnd: "13:00", logoutSuggestAfter: "16:00" } });
  check("settings updated", r.status === 200 && r.json.settings.workingDays.length === 7);
  r = await me.post("/api/device/tokens", { label: "Pixel (Tasker)" });
  check("device token created once", r.status === 201 && r.json.token.startsWith("pims_"));
  const token = r.json.token;
  const tokenId = r.json.id;
  const hook = (body, tok = token) =>
    fetch(BASE + "/api/device/event", { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }).then(async (res) => ({ status: res.status, json: await res.json() }));
  r = await hook({ event: "unlock" }, null);
  check("webhook without token → 401", r.status === 401);
  r = await hook({ event: "unlock" }, "pims_bogus");
  check("webhook with bad token → 401", r.status === 401);
  r = await hook({ event: "explode" });
  check("invalid event type rejected", r.status === 400);
  r = await hook({ event: "unlock", timestamp: at(w, "09:58"), device: "Pixel 8" });
  check("first morning unlock → pending login suggestion", r.json.status === "pending" && r.json.suggestedAction === "login", r.json);
  const loginEv = r.json.eventId;
  r = await hook({ event: "unlock", timestamp: at(w, "09:58") });
  check("retried identical event → duplicate", r.json.status === "duplicate");
  r = await hook({ event: "unlock", timestamp: at(w, "10:20") });
  check("repeat unlock same session → ignored (not a new login)", r.json.status === "ignored" && r.json.reason === "login_already_suggested", r.json);
  r = await me.get("/api/attendance/today");
  check("suggestion is listed for confirmation", r.json.pendingEvents.some((e) => e.id === loginEv));
  r = await me.get(`/api/attendance?month=${w.slice(0, 7)}`);
  check("pending suggestion did NOT create attendance", !r.json.days.find((d) => d.date === w)?.record);
  r = await me.post(`/api/attendance/events/${loginEv}/confirm`, {});
  check("confirm → attendance login (source automatic)", r.status === 200 && r.json.attendance.loginSource === "automatic" && r.json.attendance.firstLoginAt === utc(w, "09:58"), r.json);
  r = await hook({ event: "unlock", timestamp: at(w, "13:30") });
  check("later unlock after login → ignored", r.json.status === "ignored" && r.json.reason === "already_logged_in_today", r.json);
  r = await hook({ event: "lock", timestamp: at(w, "12:05") });
  check("midday lock → ignored", r.json.status === "ignored" && r.json.reason === "before_logout_window", r.json);
  r = await hook({ event: "lock", timestamp: at(w, "19:20") });
  const lock1 = r.json.eventId;
  check("evening lock → pending logout suggestion", r.json.status === "pending" && r.json.suggestedAction === "logout");
  r = await hook({ event: "lock", timestamp: at(w, "19:45") });
  const lock2 = r.json.eventId;
  r = await me.get("/api/attendance/events?status=pending");
  check("latest lock supersedes the earlier suggestion", r.json.events.some((e) => e.id === lock2) && !r.json.events.some((e) => e.id === lock1));
  r = await me.post(`/api/attendance/events/${lock2}/confirm`, {});
  check("confirm logout → 19:45 → overtime 45m", r.json.attendance.lastLogoutAt === utc(w, "19:45") && r.json.attendance.overtimeMinutes === 45 && r.json.attendance.logoutSource === "automatic", r.json);
  r = await me.post(`/api/attendance/events/${lock2}/reject`);
  check("a confirmed event cannot be rejected", r.status === 400);
  r = await hook({ event: "unlock", timestamp: at(addDays(today, -8), "09:00") });
  check("event older than 7 days rejected", r.status === 400);
  // Day d5 has a manual "leave" record and no login → free for the remaining scenarios.
  r = await hook({ event: "unlock", timestamp: at(d5, "22:00") });
  check("unlock outside the login window → ignored", r.json.status === "ignored" && r.json.reason === "outside_login_window", r.json);
  await me.put("/api/settings", { settings: { workingDays: allDays.filter((x) => x !== dow(d5)) } });
  r = await hook({ event: "unlock", timestamp: at(d5, "09:30") });
  check("unlock on a non-working day → ignored", r.json.status === "ignored" && r.json.reason === "non_working_day", r.json);
  await me.put("/api/settings", { settings: { automationEnabled: false } });
  r = await hook({ event: "unlock", timestamp: at(d5, "09:20") });
  check("automation disabled → accepted:false", r.json.accepted === false && r.json.reason === "automation_disabled");
  await me.put("/api/settings", { settings: { automationEnabled: true, workingDays: allDays } });
  r = await hook({ event: "unlock", timestamp: at(d5, "09:10") });
  check("valid morning unlock on a free day → pending", r.json.status === "pending");
  r = await me.post(`/api/attendance/events/${r.json.eventId}/reject`);
  check("reject a suggestion", r.status === 200);
  r = await me.get(`/api/attendance?month=${d5.slice(0, 7)}`);
  const d5rec = r.json.days.find((d) => d.date === d5)?.record;
  check("rejected event left attendance untouched (still leave, no login)", d5rec?.status === "leave" && d5rec.firstLoginAt === null);
  await me.put("/api/settings", { settings: { workingDays: [1, 2, 3, 4, 5] } });
  r = await me.get("/api/attendance/events?includeIgnored=1&limit=100");
  check("every event shows its source (automatic / manual)", r.json.events.some((e) => e.source === "manual") && r.json.events.some((e) => e.source === "automatic") && r.json.events.some((e) => e.status === "ignored"));
  r = await me.del(`/api/device/tokens/${tokenId}`);
  check("token revoked", r.status === 200);
  r = await hook({ event: "unlock" });
  check("revoked token no longer works", r.status === 401);

  section("Development log");
  r = await me.post("/api/devlogs", { logDate: today, area: "Backend Implementation", taskId: t1.id, implemented: "Built Hono REST API", technologies: "Hono, D1, TypeScript", problems: "D1 batch semantics", solutions: "Used db.batch", nextPlan: "Add pagination\nWrite tests" });
  check("create dev log", r.status === 201 && r.json.log.taskCode === "TSK-0001");
  const logId = r.json.log.id;
  await me.post("/api/devlogs", { logDate: today, area: "Frontend Implementation", implemented: "Task grid with inline editing", technologies: "React, Tailwind", status: "Completed" });
  r = await me.patch(`/api/devlogs/${logId}`, { status: "Completed" });
  check("update dev log", r.json.log.status === "Completed");
  r = await me.get(`/api/devlogs/summary?date=${today}`);
  check("daily dev summary groups by area + rolls up tech/problems/next steps", r.json.byArea.length === 2 && r.json.technologies.includes("Hono") && r.json.problems.length === 1 && r.json.nextSteps.length === 2, r.json);
  r = await me.post("/api/devlogs", { logDate: today, area: "Integration", taskId: 99999 });
  check("dev log rejects a missing / foreign task", r.status === 400);

  section("Daily report generation");
  await me.patch(`/api/tasks/${t1.id}`, { implementationNotes: "Implemented tasks + attendance APIs", progressPercent: 70 });
  r = await me.post("/api/reports/generate", { date: addDays(today, 2) });
  check("cannot generate for a future date", r.status === 400);
  r = await me.post("/api/reports/generate", { date: today });
  check("generate creates revision-1 draft", r.status === 201 && r.json.report.revision === 1 && r.json.report.status === "draft", r.json);
  const rep = r.json.report;
  check("header has employee, mentor, attendance from real records", rep.header.employeeName === "Hasibur Rahman" && rep.header.mentorName === "xyz" && !!rep.header.attendance?.loginAt, rep.header);
  check("in-progress section lists real tasks with progress", rep.content.inProgress.some((t) => t.code === "TSK-0001" && t.progress === 70));
  check("technical section uses dev logs", rep.content.technical.backend.some((s) => s.includes("Hono REST API")) && rep.content.technical.frontend.some((s) => s.includes("Task grid")));
  check("challenges pulled from dev log problems", rep.content.challenges.some((c) => c.problem === "D1 batch semantics" && c.solution === "Used db.batch"));
  check("next-day plan populated", rep.content.nextPlan.includes("Add pagination") && rep.content.nextPlan.some((s) => s.startsWith("Continue:")));
  check("pending section has reasons", rep.content.pending.length > 0 && rep.content.pending.every((p) => p.reason));
  r = await me.post("/api/reports/generate", { date: today });
  check("generate again returns the same draft", r.json.report.id === rep.id && r.json.created === false);
  const edited = { ...rep.content, summary: "Edited summary for TL.", challenges: [...rep.content.challenges, { problem: "CORS in dev", solution: "Vite proxy" }] };
  r = await me.put(`/api/reports/${rep.id}`, { content: edited });
  check("edit draft persists", r.json.report.content.summary === "Edited summary for TL." && r.json.report.content.challenges.length === 2);
  r = await me.get(`/api/reports/by-date/${today}`);
  check("edit survives reload", r.json.report.content.summary === "Edited summary for TL.");
  const shareToken = rep.shareToken;
  r = await new Client().get(`/api/public/reports/${shareToken}`);
  check("draft share link is NOT public (404)", r.status === 404);

  section("Submit, lock, share link");
  r = await me.post(`/api/reports/${rep.id}/submit`);
  check("submit → status submitted + locked", r.json.report.status === "submitted" && !!r.json.report.submittedAt && r.json.report.locked === true);
  r = await me.put(`/api/reports/${rep.id}`, { content: edited });
  check("submitted version is locked (409)", r.status === 409 && r.json.error.code === "report_locked");
  r = await me.post("/api/reports/generate", { date: today, regenerate: true });
  check("cannot regenerate over a submitted report", r.status === 409);
  r = await me.get(`/api/public/reports/${shareToken}`);
  check("owner previewing own link does not mark viewed", r.status === 200 && r.json.report.status === "submitted");
  const anon = new Client();
  r = await anon.get(`/api/public/reports/${shareToken}`);
  check("anonymous visitor can read the submitted report", r.status === 200 && r.json.report.header.employeeName === "Hasibur Rahman");
  check("…and it is marked viewed", r.json.report.status === "viewed");
  r = await anon.get("/api/public/reports/aaaaaaaaaaaaaaaaaaaaaaaa");
  check("unknown token → 404", r.status === 404);
  r = await anon.get("/api/tasks");
  check("share link grants no other access", r.status === 401);

  section("Revisions");
  r = await me.post(`/api/reports/${rep.id}/revise`);
  check("revise creates revision 2 draft with copied content", r.status === 201 && r.json.report.revision === 2 && r.json.report.status === "draft" && r.json.report.content.summary === "Edited summary for TL.");
  const rev2 = r.json.report;
  r = await me.post(`/api/reports/${rep.id}/revise`);
  check("revising again returns the existing draft", r.json.report.id === rev2.id && r.json.created === false);
  await me.put(`/api/reports/${rev2.id}`, { content: { ...rev2.content, summary: "Revision 2 summary." } });
  r = await me.get(`/api/reports/${rep.id}`);
  check("original submitted version unchanged", r.json.report.content.summary === "Edited summary for TL.");

  section("TL account & review");
  r = await me.post("/api/settings/tl", { name: "Karim Hossain", email: "tl@example.com", password: PASSWORD });
  check("TL account created and linked", r.status === 201 && r.json.tl?.email === "tl@example.com" && r.json.profile.mentorName === "Karim Hossain");
  r = await tlc.post("/api/auth/login", { email: "tl@example.com", password: PASSWORD });
  check("TL can sign in", r.status === 200 && r.json.user.role === "tl");
  r = await tlc.get("/api/tasks");
  check("TL cannot access intern tasks (403)", r.status === 403);
  r = await tlc.get("/api/attendance/today");
  check("TL cannot access attendance (403)", r.status === 403);
  r = await tlc.get("/api/tl/reports");
  check("TL sees submitted reports only", r.json.reports.length === 1 && r.json.reports[0].id === rep.id && r.json.reports[0].internName === "Hasibur Rahman", r.json);
  r = await me.post(`/api/reports/${rev2.id}/submit`);
  check("revision 2 submitted", r.json.report.status === "submitted");
  r = await tlc.get(`/api/tl/reports/${rev2.id}`);
  check("TL opening a report marks it viewed", r.json.report.status === "viewed");
  r = await tlc.post(`/api/tl/reports/${rep.id}/review`, { action: "approved" });
  check("cannot review a superseded revision (409)", r.status === 409 && r.json.error.code === "superseded");
  r = await tlc.post(`/api/tl/reports/${rev2.id}/review`, { action: "revision_requested", comment: "" });
  check("revision request needs a comment", r.status === 400);
  r = await tlc.post(`/api/tl/reports/${rev2.id}/review`, { action: "revision_requested", comment: "Please add time spent per task." });
  check("TL requests revision", r.json.report.status === "revision_requested");
  r = await me.get(`/api/reports/${rev2.id}`);
  check("intern sees the TL feedback and view event", r.json.report.reviews.some((x) => x.action === "revision_requested" && x.comment.includes("time spent")) && r.json.report.reviews.some((x) => x.action === "viewed"));
  r = await me.post(`/api/reports/${rev2.id}/revise`);
  const rev3 = r.json.report;
  check("revision 3 created after feedback", rev3.revision === 3);
  await me.post(`/api/reports/${rev3.id}/submit`);
  r = await tlc.post(`/api/tl/reports/${rev3.id}/review`, { action: "approved", comment: "Good work." });
  check("TL approves latest revision", r.json.report.status === "approved" && !!r.json.report.reviewedAt);
  r = await me.get("/api/reports");
  check("report history lists every revision with status", r.json.reports.length === 3 && r.json.reports[0].status === "approved");

  section("Dashboard & analytics");
  r = await me.get("/api/dashboard");
  const dash = r.json;
  check("dashboard shape", dash.date === today && !!dash.attendance.firstLoginAt && dash.trend.length === 7 && dash.byStatus.length === 6, dash.tasks);
  check("dashboard completion % is consistent", dash.tasks.total === dash.tasks.completed + dash.tasks.inProgress + dash.tasks.pending && dash.tasks.completionPercent === Math.round((dash.tasks.completed / dash.tasks.total) * 100), dash.tasks);
  check("dashboard exposes today's report status", dash.report?.status === "approved");
  r = await me.get(`/api/analytics?from=${addDays(today, -10)}&to=${today}`);
  check("analytics totals", r.status === 200 && r.json.attendance.daysAttended >= 5 && r.json.tasks.total >= 5 && r.json.reports.total === 3, r.json.attendance);
  r = await me.get("/api/analytics?from=2020-01-01&to=2026-01-01");
  check("analytics range capped at one year", r.status === 400);

  section("Export & backup");
  r = await me.get("/api/export");
  const backup = JSON.parse(r.text);
  check("JSON backup contains all datasets", r.status === 200 && backup.tasks.length >= 6 && backup.attendance.length >= 5 && backup.reports.length === 3 && backup.taskActivity.length > 5 && backup.attendanceAudit.length > 5);
  r = await me.get("/api/export/tasks.csv");
  check("CSV export neutralises formula injection", r.text.includes(`"'=HYPERLINK(`) && r.text.includes("TSK-0001"));

  section("Sessions, passwords, brute-force protection");
  r = await me.post("/api/auth/change-password", { currentPassword: "wrong-password-1", newPassword: "another-long-password" });
  check("change password needs current password", r.status === 400);
  r = await me.post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: "another-long-password" });
  check("password changed", r.status === 200);
  r = await new Client().post("/api/auth/login", { email: "HASIB@example.com", password: "another-long-password" });
  check("login with new password (email case-insensitive)", r.status === 200);
  await me.post("/api/auth/logout");
  r = await me.get("/api/auth/me");
  check("logout invalidates session", r.status === 401);
  let last;
  for (let i = 0; i < 9; i++) last = await new Client().post("/api/auth/login", { email: "nobody@example.com", password: "whatever-password" });
  check("repeated failures are rate limited (429)", last.status === 429);
  r = await new Client().post("/api/auth/login", { email: "hasib@example.com", password: "another-long-password" });
  check("rate limit is per-account (real user unaffected)", r.status === 200);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(2);
});
