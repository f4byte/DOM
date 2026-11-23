import { Hono } from "hono";
import { TASK_STATUSES } from "../../../shared/constants";
import { addDays, isValidDate, localDate } from "../../../shared/time";
import type { AnalyticsDTO, DashboardDTO } from "../../../shared/types";
import type { AppEnv } from "../env";
import { getAttendanceByDate, toAttendanceDTO, type AttendanceRow } from "../lib/attendance";
import { badRequest } from "../lib/http";
import { getSettings } from "../lib/settings";
import { toTaskDTO, type TaskRow } from "../lib/tasks";

export const dashboard = new Hono<AppEnv>();
export const analytics = new Hono<AppEnv>();

dashboard.get("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const now = new Date();
  const date = localDate(now);
  const settings = await getSettings(db, user.id);

  const [attRow, scope, overdue, upcoming, trendAtt, trendDone, report, pending, profile] = await Promise.all([
    getAttendanceByDate(db, user.id, date),
    // Today's workload: assigned today, completed today, or still open from earlier days.
    db
      .prepare(
        `SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND (
           assigned_date = ? OR (completed_at IS NOT NULL AND date(completed_at, '+6 hours') = ?) OR (status != 'Completed' AND assigned_date < ?))`,
      )
      .bind(user.id, date, date, date)
      .all<TaskRow>(),
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status != 'Completed' AND deadline IS NOT NULL AND deadline < ?").bind(user.id, now.toISOString()).first<{ n: number }>(),
    db
      .prepare("SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND status != 'Completed' AND deadline IS NOT NULL ORDER BY deadline ASC LIMIT 5")
      .bind(user.id)
      .all<TaskRow>(),
    db.prepare("SELECT * FROM attendance WHERE user_id = ? AND work_date >= ? AND work_date <= ?").bind(user.id, addDays(date, -6), date).all<AttendanceRow>(),
    db
      .prepare("SELECT date(completed_at, '+6 hours') AS d, COUNT(*) AS n FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND completed_at >= ? GROUP BY d")
      .bind(user.id, new Date(now.getTime() - 8 * 86_400_000).toISOString())
      .all<{ d: string; n: number }>(),
    db.prepare("SELECT id, status, revision FROM daily_reports WHERE user_id = ? AND report_date = ? ORDER BY revision DESC LIMIT 1").bind(user.id, date).first<{ id: number; status: DashboardDTO["report"] extends infer R ? (R extends { status: infer S } ? S : never) : never; revision: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM attendance_events WHERE user_id = ? AND status = 'pending'").bind(user.id).first<{ n: number }>(),
    db.prepare("SELECT full_name FROM profiles WHERE user_id = ?").bind(user.id).first<{ full_name: string }>(),
  ]);

  const rows = scope.results;
  const completed = rows.filter((t) => t.status === "Completed").length;
  const inProgress = rows.filter((t) => t.status === "In Progress" || t.status === "Under Review").length;
  const pendingCount = rows.filter((t) => ["Not Started", "On Hold", "Blocked"].includes(t.status)).length;

  const attByDate = new Map(trendAtt.results.map((r) => [r.work_date, r]));
  const doneByDate = new Map(trendDone.results.map((r) => [r.d, r.n]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(date, i - 6);
    const a = attByDate.get(d);
    const dto = a ? toAttendanceDTO(a, d, settings, now) : null;
    return { date: d, workedMinutes: dto?.workedMinutes ?? 0, overtimeMinutes: dto?.overtimeMinutes ?? 0, tasksCompleted: doneByDate.get(d) ?? 0 };
  });

  const catCount = new Map<string, number>();
  for (const t of rows) catCount.set(t.category, (catCount.get(t.category) ?? 0) + 1);

  const body: DashboardDTO = {
    date,
    fullName: profile?.full_name ?? user.fullName,
    attendance: toAttendanceDTO(attRow, date, settings, now),
    schedule: { officeStart: settings.officeStart, officeEnd: settings.officeEnd },
    pendingEventCount: pending?.n ?? 0,
    tasks: {
      total: rows.length,
      completed,
      inProgress,
      pending: pendingCount,
      assignedToday: rows.filter((t) => t.assigned_date === date).length,
      completionPercent: rows.length ? Math.round((completed / rows.length) * 100) : 0,
      overdue: overdue?.n ?? 0,
    },
    byStatus: TASK_STATUSES.map((s) => ({ status: s, count: rows.filter((t) => t.status === s).length })),
    byCategory: [...catCount.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    trend,
    upcoming: upcoming.results.map((t) => toTaskDTO(t, now)),
    report: report ? { id: report.id, status: report.status, revision: report.revision } : null,
  };
  return c.json(body);
});

analytics.get("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const now = new Date();
  const today = localDate(now);
  const to = c.req.query("to") ?? today;
  const from = c.req.query("from") ?? addDays(to, -29);
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest("Invalid date range");
  if (from > to) throw badRequest("'from' must not be after 'to'");
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 366) throw badRequest("Range cannot exceed one year");
  const settings = await getSettings(db, user.id);
  const fromUtc = new Date(`${from}T00:00:00+06:00`).toISOString();
  const toUtc = new Date(`${addDays(to, 1)}T00:00:00+06:00`).toISOString();

  const [attRes, taskRes, repRes] = await Promise.all([
    db.prepare("SELECT * FROM attendance WHERE user_id = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date").bind(user.id, from, to).all<AttendanceRow>(),
    db
      .prepare(
        `SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND (
           (assigned_date >= ? AND assigned_date <= ?) OR (completed_at >= ? AND completed_at < ?))`,
      )
      .bind(user.id, from, to, fromUtc, toUtc)
      .all<TaskRow>(),
    db.prepare("SELECT status, COUNT(*) AS n FROM daily_reports WHERE user_id = ? AND report_date >= ? AND report_date <= ? GROUP BY status").bind(user.id, from, to).all<{ status: string; n: number }>(),
  ]);

  const days = attRes.results
    .map((r) => toAttendanceDTO(r, r.work_date, settings, now))
    .filter((d) => d.firstLoginAt)
    .map((d) => ({ date: d.workDate, workedMinutes: d.workedMinutes, overtimeMinutes: d.overtimeMinutes, lateMinutes: d.lateMinutes, earlyDepartureMinutes: d.earlyDepartureMinutes, status: d.status }));
  const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((n, d) => n + f(d), 0);
  const closed = days.filter((d) => d.status !== "in_progress" && d.status !== "missing_logout");

  const tasksRows = taskRes.results;
  const cat = new Map<string, { total: number; completed: number; actualMinutes: number }>();
  for (const t of tasksRows) {
    const e = cat.get(t.category) ?? { total: 0, completed: 0, actualMinutes: 0 };
    e.total++;
    if (t.status === "Completed") e.completed++;
    e.actualMinutes += t.actual_minutes ?? 0;
    cat.set(t.category, e);
  }
  const countBy = (key: "status" | "priority") => {
    const m = new Map<string, number>();
    for (const t of tasksRows) m.set(t[key], (m.get(t[key]) ?? 0) + 1);
    return [...m.entries()];
  };
  const doneMap = new Map<string, number>();
  let onTime = 0;
  let late = 0;
  for (const t of tasksRows) {
    if (!t.completed_at) continue;
    const d = localDate(t.completed_at);
    if (d >= from && d <= to) doneMap.set(d, (doneMap.get(d) ?? 0) + 1);
    if (t.deadline) (new Date(t.completed_at) <= new Date(t.deadline) ? onTime++ : late++);
  }

  const body: AnalyticsDTO = {
    from,
    to,
    attendance: {
      days,
      totalWorkedMinutes: sum((d) => d.workedMinutes),
      totalOvertimeMinutes: sum((d) => d.overtimeMinutes),
      totalLateMinutes: sum((d) => d.lateMinutes),
      totalEarlyDepartureMinutes: sum((d) => d.earlyDepartureMinutes),
      daysAttended: days.length,
      onTimeDays: days.filter((d) => d.lateMinutes === 0).length,
      lateDays: days.filter((d) => d.lateMinutes > 0).length,
      averageWorkedMinutes: closed.length ? Math.round(closed.reduce((n, d) => n + d.workedMinutes, 0) / closed.length) : 0,
    },
    tasks: {
      total: tasksRows.length,
      completed: tasksRows.filter((t) => t.status === "Completed").length,
      byCategory: [...cat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total),
      byStatus: countBy("status").map(([status, count]) => ({ status, count })),
      byPriority: countBy("priority").map(([priority, count]) => ({ priority, count })),
      completedPerDay: [...doneMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      completedOnTime: onTime,
      completedLate: late,
    },
    reports: { total: repRes.results.reduce((n, r) => n + r.n, 0), byStatus: repRes.results.map((r) => ({ status: r.status, count: r.n })) },
  };
  return c.json(body);
});
