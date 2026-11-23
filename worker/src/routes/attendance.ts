import { Hono } from "hono";
import type { AttendanceDayDTO, AttendanceAuditDTO } from "../../../shared/types";
import { daysInMonth, localDate, weekdayOf } from "../../../shared/time";
import type { AppEnv } from "../env";
import {
  applyClock,
  correctAttendance,
  getAttendanceByDate,
  toAttendanceDTO,
  toEventDTO,
  type AttendanceRow,
  type EventRow,
} from "../lib/attendance";
import { confirmEvent, recordManualEvent, rejectEvent } from "../lib/device-events";
import { badRequest, parseBody, parseId, parseWith } from "../lib/http";
import { getSettings } from "../lib/settings";
import { clockSchema, confirmEventSchema, dateStr, manualCorrectionSchema, monthStr } from "../lib/validation";

export const attendance = new Hono<AppEnv>();

async function pendingEvents(db: D1Database, userId: number) {
  const { results } = await db
    .prepare("SELECT * FROM attendance_events WHERE user_id = ? AND status = 'pending' ORDER BY occurred_at DESC LIMIT 20")
    .bind(userId)
    .all<EventRow>();
  return results.map(toEventDTO);
}

attendance.get("/today", async (c) => {
  const user = c.get("user");
  const settings = await getSettings(c.env.DB, user.id);
  const now = new Date();
  const date = localDate(now);
  const row = await getAttendanceByDate(c.env.DB, user.id, date);
  // An unfinished day from yesterday (e.g. past-midnight work) still counts as "today" until closed.
  return c.json({
    date,
    attendance: toAttendanceDTO(row, date, settings, now),
    pendingEvents: await pendingEvents(c.env.DB, user.id),
    automationEnabled: settings.automationEnabled,
    schedule: { officeStart: settings.officeStart, officeEnd: settings.officeEnd },
  });
});

attendance.get("/", async (c) => {
  const user = c.get("user");
  const month = parseWith(monthStr, c.req.query("month") ?? localDate(new Date()).slice(0, 7));
  const settings = await getSettings(c.env.DB, user.id);
  const now = new Date();
  const today = localDate(now);

  const { results } = await c.env.DB.prepare("SELECT * FROM attendance WHERE user_id = ? AND work_date LIKE ? ORDER BY work_date")
    .bind(user.id, `${month}-%`)
    .all<AttendanceRow>();
  const byDate = new Map(results.map((r) => [r.work_date, r]));
  const created = await c.env.DB.prepare("SELECT created_at FROM users WHERE id = ?").bind(user.id).first<{ created_at: string }>();
  const startDate = created ? localDate(created.created_at) : "0000-00-00";

  const days: AttendanceDayDTO[] = daysInMonth(month).map((date) => {
    const weekday = weekdayOf(date);
    const isWorkingDay = settings.workingDays.includes(weekday);
    const row = byDate.get(date) ?? null;
    let placeholder: AttendanceDayDTO["placeholder"] = null;
    if (!row) {
      if (date > today) placeholder = "future";
      else if (date < startDate) placeholder = "before_start";
      else if (!isWorkingDay) placeholder = "weekend";
      else if (date < today) placeholder = "absent";
    }
    return { date, weekday, isWorkingDay, placeholder, record: row ? toAttendanceDTO(row, date, settings, now) : null };
  });

  const recs = days.map((d) => d.record).filter((r): r is NonNullable<typeof r> => !!r && !!r.firstLoginAt);
  const completed = recs.filter((r) => r.lastLogoutAt);
  const sum = (f: (r: (typeof recs)[number]) => number) => recs.reduce((n, r) => n + f(r), 0);
  const summary = {
    daysPresent: recs.length,
    daysAbsent: days.filter((d) => d.placeholder === "absent" || d.record?.status === "absent").length,
    daysLeave: days.filter((d) => d.record?.status === "leave" || d.record?.status === "holiday").length,
    lateDays: recs.filter((r) => r.lateMinutes > 0).length,
    earlyLeaveDays: recs.filter((r) => r.earlyDepartureMinutes > 0).length,
    totalWorkedMinutes: sum((r) => r.workedMinutes),
    totalOvertimeMinutes: sum((r) => r.overtimeMinutes),
    totalLateMinutes: sum((r) => r.lateMinutes),
    totalEarlyDepartureMinutes: sum((r) => r.earlyDepartureMinutes),
    averageWorkedMinutes: completed.length ? Math.round(completed.reduce((n, r) => n + r.workedMinutes, 0) / completed.length) : 0,
  };
  return c.json({ month, days, summary, schedule: { officeStart: settings.officeStart, officeEnd: settings.officeEnd } });
});

/** Manual one-click login. Always uses the server clock; backdating needs a correction with a reason. */
attendance.post("/clock-in", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const { note } = parseWith(clockSchema, body);
  const settings = await getSettings(c.env.DB, user.id);
  const at = new Date().toISOString();
  const { row, changed } = await applyClock(c.env.DB, user.id, "login", at, "manual", settings, note ?? null);
  if (changed) await recordManualEvent(c.env.DB, user.id, "login", at, row.work_date, row.id);
  return c.json({ changed, attendance: toAttendanceDTO(row, row.work_date, settings) });
});

attendance.post("/clock-out", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const { note } = parseWith(clockSchema, body);
  const settings = await getSettings(c.env.DB, user.id);
  const at = new Date().toISOString();
  const { row, changed } = await applyClock(c.env.DB, user.id, "logout", at, "manual", settings, note ?? null);
  if (changed) await recordManualEvent(c.env.DB, user.id, "logout", at, row.work_date, row.id);
  return c.json({ changed, attendance: toAttendanceDTO(row, row.work_date, settings) });
});

attendance.get("/events", async (c) => {
  const user = c.get("user");
  const status = c.req.query("status");
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
  const where = ["user_id = ?"];
  const params: unknown[] = [user.id];
  if (status === "pending") where.push("status = 'pending'");
  else if (c.req.query("includeIgnored") !== "1") where.push("status != 'ignored'");
  const { results } = await c.env.DB.prepare(`SELECT * FROM attendance_events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT ${limit}`)
    .bind(...params)
    .all<EventRow>();
  return c.json({ events: results.map(toEventDTO) });
});

attendance.post("/events/:id/confirm", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const { action } = parseWith(confirmEventSchema, body);
  const settings = await getSettings(c.env.DB, user.id);
  const row = await confirmEvent(c.env.DB, user.id, settings, id, action);
  return c.json({ attendance: toAttendanceDTO(row, row.work_date, settings), pendingEvents: await pendingEvents(c.env.DB, user.id) });
});

attendance.post("/events/:id/reject", async (c) => {
  const user = c.get("user");
  await rejectEvent(c.env.DB, user.id, parseId(c.req.param("id")));
  return c.json({ ok: true, pendingEvents: await pendingEvents(c.env.DB, user.id) });
});

attendance.get("/audit", async (c) => {
  const user = c.get("user");
  const date = c.req.query("date");
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 300);
  const where = ["a.user_id = ?"];
  const params: unknown[] = [user.id];
  if (date) {
    where.push("att.work_date = ?");
    params.push(parseWith(dateStr, date));
  }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, att.work_date, a.action, a.field, a.old_value, a.new_value, a.reason, a.source, a.created_at
       FROM attendance_audit_logs a JOIN attendance att ON att.id = a.attendance_id
      WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit}`,
  )
    .bind(...params)
    .all<{ id: number; work_date: string; action: string; field: string | null; old_value: string | null; new_value: string | null; reason: string | null; source: "automatic" | "manual"; created_at: string }>();
  const audit: AttendanceAuditDTO[] = results.map((r) => ({ id: r.id, workDate: r.work_date, action: r.action, field: r.field, oldValue: r.old_value, newValue: r.new_value, reason: r.reason, source: r.source, createdAt: r.created_at }));
  return c.json({ audit });
});

/** Manual correction for a specific day. A reason is mandatory and the change is audited. */
attendance.put("/:date", async (c) => {
  const user = c.get("user");
  const date = parseWith(dateStr, c.req.param("date"));
  if (date > localDate(new Date())) throw badRequest("Cannot record attendance for a future date");
  const body = await parseBody(c, manualCorrectionSchema);
  const settings = await getSettings(c.env.DB, user.id);
  const row = await correctAttendance(c.env.DB, user.id, date, body, settings);
  return c.json({ attendance: toAttendanceDTO(row, date, settings) });
});
