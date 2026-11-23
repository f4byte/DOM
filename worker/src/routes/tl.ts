// Read-only TL dashboard API: reports of the interns this TL mentors, plus review actions.
import { Hono } from "hono";
import type { ReportStatus } from "../../../shared/constants";
import type { AppEnv } from "../env";
import { conflict, parseBody, parseId, badRequest, notFound } from "../lib/http";
import { latestSubmittedInfo, loadReviews, markViewed, toReportDTO, type ReportRow } from "../lib/reports";
import { reviewSchema } from "../lib/validation";

export const tl = new Hono<AppEnv>();

const SELECT = `SELECT r.*, p.full_name AS intern_name FROM daily_reports r JOIN profiles p ON p.user_id = r.user_id`;

async function loadForTl(db: D1Database, tlId: number, id: number): Promise<ReportRow> {
  const r = await db.prepare(`${SELECT} WHERE r.id = ? AND p.mentor_user_id = ? AND r.status != 'draft'`).bind(id, tlId).first<ReportRow>();
  if (!r) throw notFound("Report not found");
  return r;
}

tl.get("/reports", async (c) => {
  const status = c.req.query("status");
  const where = ["p.mentor_user_id = ?", "r.status != 'draft'"];
  const params: unknown[] = [c.get("user").id];
  if (status) {
    where.push("r.status = ?");
    params.push(status);
  }
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.report_date DESC, r.revision DESC LIMIT 300`).bind(...params).all<ReportRow>();
  return c.json({ reports: results.map((r) => toReportDTO(r)) });
});

tl.get("/reports/:id", async (c) => {
  const user = c.get("user");
  let r = await loadForTl(c.env.DB, user.id, parseId(c.req.param("id")));
  r = await markViewed(c.env.DB, r, { userId: user.id, name: user.fullName });
  return c.json({ report: toReportDTO(r, await loadReviews(c.env.DB, r.id)), latest: await latestSubmittedInfo(c.env.DB, r) });
});

tl.post("/reports/:id/review", async (c) => {
  const user = c.get("user");
  const r = await loadForTl(c.env.DB, user.id, parseId(c.req.param("id")));
  const { action, comment } = await parseBody(c, reviewSchema);
  if ((action === "comment" || action === "revision_requested") && !comment) throw badRequest("A comment is required for this action");

  const newer = await latestSubmittedInfo(c.env.DB, r);
  if (newer) throw conflict(`This version was superseded by revision ${newer.revision}. Review the latest revision instead.`, "superseded");

  const now = new Date().toISOString();
  const statusFor: Record<string, ReportStatus | null> = { comment: r.status === "submitted" ? "viewed" : null, reviewed: "reviewed", revision_requested: "revision_requested", approved: "approved" };
  const next = statusFor[action];
  const stmts = [
    c.env.DB.prepare("INSERT INTO report_reviews (report_id, reviewer_user_id, reviewer_name, action, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(r.id, user.id, user.fullName, action, comment, now),
  ];
  if (next) {
    stmts.push(
      c.env.DB
        .prepare("UPDATE daily_reports SET status = ?, reviewed_at = CASE WHEN ? = 'comment' THEN reviewed_at ELSE ? END, viewed_at = COALESCE(viewed_at, ?), updated_at = ? WHERE id = ?")
        .bind(next, action, now, now, now, r.id),
    );
  }
  await c.env.DB.batch(stmts);
  const fresh = await loadForTl(c.env.DB, user.id, r.id);
  return c.json({ report: toReportDTO(fresh, await loadReviews(c.env.DB, r.id)) });
});
