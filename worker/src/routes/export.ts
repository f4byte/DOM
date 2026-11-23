// Backup & export: everything the user owns as JSON, and tasks as CSV.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getSettings } from "../lib/settings";

export const exportRoutes = new Hono<AppEnv>();

/** Neutralise spreadsheet formula injection and quote CSV fields. */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

exportRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const uid = c.get("user").id;
  const all = async (sql: string) => (await db.prepare(sql).bind(uid).all()).results;
  const body = {
    exportedAt: new Date().toISOString(),
    app: c.env.APP_NAME ?? "DOM",
    timezone: "Asia/Dhaka",
    profile: await db.prepare("SELECT u.email, p.full_name, p.employment_type, p.mentor_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?").bind(uid).first(),
    settings: await getSettings(db, uid),
    tasks: await all("SELECT * FROM tasks WHERE user_id = ? ORDER BY seq"),
    taskActivity: await all("SELECT * FROM task_activity_logs WHERE user_id = ? ORDER BY id"),
    devLogs: await all("SELECT * FROM dev_logs WHERE user_id = ? ORDER BY log_date, id"),
    attendance: await all("SELECT * FROM attendance WHERE user_id = ? ORDER BY work_date"),
    attendanceEvents: await all("SELECT * FROM attendance_events WHERE user_id = ? ORDER BY occurred_at"),
    attendanceAudit: await all("SELECT * FROM attendance_audit_logs WHERE user_id = ? ORDER BY id"),
    reports: await all("SELECT * FROM daily_reports WHERE user_id = ? ORDER BY report_date, revision"),
    reportReviews: await all("SELECT rr.* FROM report_reviews rr JOIN daily_reports r ON r.id = rr.report_id WHERE r.user_id = ? ORDER BY rr.id"),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="pims-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

exportRoutes.get("/tasks.csv", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY assigned_date, seq").bind(c.get("user").id).all<Record<string, unknown>>();
  const cols = ["task_code", "title", "description", "category", "assigned_date", "start_time", "deadline", "priority", "status", "estimated_minutes", "actual_minutes", "progress_percent", "implementation_notes", "blockers", "completed_at", "reference_url"];
  const csv = [cols.join(","), ...results.map((r) => cols.map((k) => csvCell(r[k])).join(","))].join("\r\n");
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pims-tasks-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
