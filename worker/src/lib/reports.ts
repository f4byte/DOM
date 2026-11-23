import type { ReportStatus } from "../../../shared/constants";
import type { PublicReportDTO, ReportContent, ReportDTO, ReportHeader, ReviewDTO } from "../../../shared/types";
import { localDate } from "../../../shared/time";
import { getAttendanceByDate, toAttendanceDTO } from "./attendance";
import { notFound } from "./http";
import { buildReport, buildHeader, reportTaskRows, type DevLogRow } from "./report-builder";
import { getSettings } from "./settings";
import type { TaskRow } from "./tasks";

export interface ReportRow {
  id: number;
  user_id: number;
  report_date: string;
  revision: number;
  status: ReportStatus;
  header_json: string;
  content_json: string;
  share_token: string;
  submitted_at: string | null;
  viewed_at: string | null;
  reviewed_at: string | null;
  pdf_key: string | null;
  created_at: string;
  updated_at: string;
  intern_name?: string;
}

export function toReportDTO(r: ReportRow, reviews?: ReviewDTO[]): ReportDTO {
  return {
    id: r.id,
    reportDate: r.report_date,
    revision: r.revision,
    status: r.status,
    locked: r.status !== "draft",
    header: JSON.parse(r.header_json) as ReportHeader,
    content: JSON.parse(r.content_json) as ReportContent,
    shareToken: r.share_token,
    submittedAt: r.submitted_at,
    viewedAt: r.viewed_at,
    reviewedAt: r.reviewed_at,
    hasPdf: !!r.pdf_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reviews,
    internName: r.intern_name,
  };
}

export async function loadReviews(db: D1Database, reportId: number): Promise<ReviewDTO[]> {
  const { results } = await db
    .prepare("SELECT id, reviewer_name, action, comment, created_at FROM report_reviews WHERE report_id = ? ORDER BY created_at ASC, id ASC")
    .bind(reportId)
    .all<{ id: number; reviewer_name: string; action: ReviewDTO["action"]; comment: string; created_at: string }>();
  return results.map((r) => ({ id: r.id, reviewerName: r.reviewer_name, action: r.action, comment: r.comment, createdAt: r.created_at }));
}

export async function getOwnedReport(db: D1Database, userId: number, id: number): Promise<ReportRow> {
  const row = await db.prepare("SELECT * FROM daily_reports WHERE id = ? AND user_id = ?").bind(id, userId).first<ReportRow>();
  if (!row) throw notFound("Report not found");
  return row;
}

export async function latestRevision(db: D1Database, userId: number, date: string): Promise<ReportRow | null> {
  return db.prepare("SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ? ORDER BY revision DESC LIMIT 1").bind(userId, date).first<ReportRow>();
}

/** First time a submitted report is opened by a reviewer → status "viewed" (logged in the review timeline). */
export async function markViewed(db: D1Database, r: ReportRow, viewer: { userId: number | null; name: string }): Promise<ReportRow> {
  if (r.status !== "submitted") return r;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE daily_reports SET status = 'viewed', viewed_at = ?, updated_at = ? WHERE id = ? AND status = 'submitted'").bind(now, now, r.id),
    db.prepare("INSERT INTO report_reviews (report_id, reviewer_user_id, reviewer_name, action, comment, created_at) VALUES (?, ?, ?, 'viewed', '', ?)").bind(r.id, viewer.userId, viewer.name, now),
  ]);
  return { ...r, status: "viewed", viewed_at: now, updated_at: now };
}

export async function reindexTasks(db: D1Database, reportId: number, content: ReportContent) {
  const stmts = [db.prepare("DELETE FROM report_tasks WHERE report_id = ?").bind(reportId)];
  for (const t of reportTaskRows(content)) {
    stmts.push(
      db
        .prepare("INSERT INTO report_tasks (report_id, task_id, section, task_code, title, category, status_at_report) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(reportId, t.taskId, t.section, t.code, t.title, t.category, t.status),
    );
  }
  await db.batch(stmts);
}

/** Gather real records for a date and assemble the header + sections. */
export async function buildForDate(db: D1Database, userId: number, date: string) {
  const [profile, settings, taskRes, logRes, attRow] = await Promise.all([
    db.prepare("SELECT full_name, mentor_name, employment_type FROM profiles WHERE user_id = ?").bind(userId).first<{ full_name: string; mentor_name: string | null; employment_type: string }>(),
    getSettings(db, userId),
    db.prepare("SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY assigned_date, seq LIMIT 2000").bind(userId).all<TaskRow>(),
    db.prepare("SELECT * FROM dev_logs WHERE user_id = ? AND log_date = ? ORDER BY id").bind(userId, date).all<DevLogRow>(),
    getAttendanceByDate(db, userId, date),
  ]);
  const attendance = attRow ? toAttendanceDTO(attRow, date, settings) : null;
  return buildReport({
    date,
    profile: { fullName: profile?.full_name ?? "", mentorName: profile?.mentor_name ?? "", employmentType: profile?.employment_type ?? "IT Intern" },
    settings,
    tasks: taskRes.results,
    devLogs: logRes.results,
    attendance,
  });
}

/** Refresh only the header (profile + attendance snapshot) — used on submit and revision. */
export async function buildHeaderForDate(db: D1Database, userId: number, date: string): Promise<ReportHeader> {
  const [profile, settings, attRow] = await Promise.all([
    db.prepare("SELECT full_name, mentor_name, employment_type FROM profiles WHERE user_id = ?").bind(userId).first<{ full_name: string; mentor_name: string | null; employment_type: string }>(),
    getSettings(db, userId),
    getAttendanceByDate(db, userId, date),
  ]);
  return buildHeader({
    date,
    profile: { fullName: profile?.full_name ?? "", mentorName: profile?.mentor_name ?? "", employmentType: profile?.employment_type ?? "IT Intern" },
    attendance: attRow ? toAttendanceDTO(attRow, date, settings, new Date(`${date}T23:59:59+06:00`)) : null,
  });
}

export async function latestSubmittedInfo(db: D1Database, r: ReportRow): Promise<PublicReportDTO["latest"]> {
  const l = await db
    .prepare("SELECT revision, share_token, status FROM daily_reports WHERE user_id = ? AND report_date = ? AND status != 'draft' ORDER BY revision DESC LIMIT 1")
    .bind(r.user_id, r.report_date)
    .first<{ revision: number; share_token: string; status: ReportStatus }>();
  return l && l.revision > r.revision ? { revision: l.revision, token: l.share_token, status: l.status } : null;
}

export const today = () => localDate(new Date());
