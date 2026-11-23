import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError, badRequest, conflict, notFound, parseBody, parseId, parseWith } from "../lib/http";
import { isReportEmpty } from "../lib/report-builder";
import {
  buildForDate,
  buildHeaderForDate,
  getOwnedReport,
  latestRevision,
  loadReviews,
  reindexTasks,
  toReportDTO,
  today,
  type ReportRow,
} from "../lib/reports";
import { randomToken } from "../lib/crypto";
import { dateStr, reportGenerateSchema, reportSaveSchema } from "../lib/validation";
import type { ReportContent } from "../../../shared/types";

export const reports = new Hono<AppEnv>();

const MAX_PDF_BYTES = 8 * 1024 * 1024;

async function withReviews(db: D1Database, r: ReportRow) {
  return toReportDTO(r, await loadReviews(db, r.id));
}

function assertDraft(r: ReportRow) {
  if (r.status !== "draft") throw conflict("This report version is locked because it was submitted. Create a revision to make changes.", "report_locked", { reportId: r.id });
}

/** History of every report and revision. */
reports.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM daily_reports WHERE user_id = ? ORDER BY report_date DESC, revision DESC LIMIT 400")
    .bind(c.get("user").id)
    .all<ReportRow>();
  return c.json({ reports: results.map((r) => toReportDTO(r)) });
});

reports.get("/by-date/:date", async (c) => {
  const user = c.get("user");
  const date = parseWith(dateStr, c.req.param("date"));
  const r = await latestRevision(c.env.DB, user.id, date);
  return c.json({ report: r ? await withReviews(c.env.DB, r) : null });
});

/** Create (or, with regenerate, rebuild) the draft for a day from the real task / attendance / dev-log records. */
reports.post("/generate", async (c) => {
  const user = c.get("user");
  const { date, regenerate } = await parseBody(c, reportGenerateSchema);
  if (date > today()) throw badRequest("Cannot generate a report for a future date");
  const latest = await latestRevision(c.env.DB, user.id, date);
  if (latest && latest.status !== "draft") {
    throw conflict("A report for this date was already submitted. Create a revision to change it.", "report_locked", { reportId: latest.id });
  }
  if (latest && !regenerate) return c.json({ report: await withReviews(c.env.DB, latest), created: false });

  const built = await buildForDate(c.env.DB, user.id, date);
  const now = new Date().toISOString();
  if (latest) {
    await c.env.DB.prepare("UPDATE daily_reports SET header_json = ?, content_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(built.header), JSON.stringify(built.content), now, latest.id)
      .run();
    await reindexTasks(c.env.DB, latest.id, built.content);
    return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, latest.id)), created: false });
  }
  const res = await c.env.DB.prepare(
    "INSERT INTO daily_reports (user_id, report_date, revision, status, header_json, content_json, share_token) VALUES (?, ?, 1, 'draft', ?, ?, ?)",
  )
    .bind(user.id, date, JSON.stringify(built.header), JSON.stringify(built.content), randomToken(24))
    .run();
  const id = res.meta.last_row_id as number;
  await reindexTasks(c.env.DB, id, built.content);
  return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, id)), created: true }, 201);
});

reports.get("/:id", async (c) => {
  const r = await getOwnedReport(c.env.DB, c.get("user").id, parseId(c.req.param("id")));
  return c.json({ report: await withReviews(c.env.DB, r) });
});

/** Save edits to a draft. */
reports.put("/:id", async (c) => {
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  assertDraft(r);
  const { content } = await parseBody(c, reportSaveSchema);
  await c.env.DB.prepare("UPDATE daily_reports SET content_json = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(content), new Date().toISOString(), r.id).run();
  await reindexTasks(c.env.DB, r.id, content as ReportContent);
  return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, r.id)) });
});

/** Pull the latest attendance + profile values into a draft's header. */
reports.post("/:id/refresh-header", async (c) => {
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  assertDraft(r);
  const header = await buildHeaderForDate(c.env.DB, user.id, r.report_date);
  await c.env.DB.prepare("UPDATE daily_reports SET header_json = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(header), new Date().toISOString(), r.id).run();
  return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, r.id)) });
});

/** Submit to the TL. Locks this revision; exporting or copying never counts as submitting. */
reports.post("/:id/submit", async (c) => {
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  assertDraft(r);
  const content = JSON.parse(r.content_json) as ReportContent;
  if (isReportEmpty(content)) throw badRequest("The report is empty. Add some content before submitting.");
  const header = await buildHeaderForDate(c.env.DB, user.id, r.report_date);
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE daily_reports SET status = 'submitted', header_json = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(JSON.stringify(header), now, now, r.id)
    .run();
  return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, r.id)) });
});

/** Start a new editable revision of a submitted report (the submitted version stays untouched). */
reports.post("/:id/revise", async (c) => {
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  if (r.status === "draft") throw badRequest("This report is still a draft — just edit it.");
  const latest = await latestRevision(c.env.DB, user.id, r.report_date);
  if (latest && latest.id !== r.id) {
    if (latest.status === "draft") return c.json({ report: await withReviews(c.env.DB, latest), created: false });
    throw conflict(`Revision ${latest.revision} already exists. Revise from the latest version.`, "not_latest", { reportId: latest.id });
  }
  const header = await buildHeaderForDate(c.env.DB, user.id, r.report_date);
  const res = await c.env.DB.prepare(
    "INSERT INTO daily_reports (user_id, report_date, revision, status, header_json, content_json, share_token) VALUES (?, ?, ?, 'draft', ?, ?, ?)",
  )
    .bind(user.id, r.report_date, r.revision + 1, JSON.stringify(header), r.content_json, randomToken(24))
    .run();
  const id = res.meta.last_row_id as number;
  await reindexTasks(c.env.DB, id, JSON.parse(r.content_json));
  return c.json({ report: await withReviews(c.env.DB, await getOwnedReport(c.env.DB, user.id, id)), created: true }, 201);
});

reports.delete("/:id", async (c) => {
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  assertDraft(r);
  if (r.pdf_key && c.env.ATTACHMENTS) await c.env.ATTACHMENTS.delete(r.pdf_key);
  await c.env.DB.prepare("DELETE FROM daily_reports WHERE id = ?").bind(r.id).run();
  return c.json({ ok: true });
});

// ---- optional R2 attachment of the exported PDF ----
reports.post("/:id/pdf", async (c) => {
  if (!c.env.ATTACHMENTS) throw new ApiError(501, "PDF storage (R2) is not enabled on this deployment", "r2_disabled");
  const user = c.get("user");
  const r = await getOwnedReport(c.env.DB, user.id, parseId(c.req.param("id")));
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_PDF_BYTES) throw badRequest("PDF must be between 1 byte and 8 MB");
  const head = new TextDecoder().decode(buf.slice(0, 5));
  if (head !== "%PDF-") throw badRequest("File is not a PDF");
  const key = `reports/${user.id}/${r.report_date}-r${r.revision}.pdf`;
  await c.env.ATTACHMENTS.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
  await c.env.DB.prepare("UPDATE daily_reports SET pdf_key = ?, updated_at = ? WHERE id = ?").bind(key, new Date().toISOString(), r.id).run();
  return c.json({ ok: true, key });
});

reports.get("/:id/pdf", async (c) => {
  if (!c.env.ATTACHMENTS) throw notFound("PDF storage is not enabled");
  const r = await getOwnedReport(c.env.DB, c.get("user").id, parseId(c.req.param("id")));
  if (!r.pdf_key) throw notFound("No PDF stored for this report");
  const obj = await c.env.ATTACHMENTS.get(r.pdf_key);
  if (!obj) throw notFound("PDF not found");
  return new Response(obj.body, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="daily-report-${r.report_date}-r${r.revision}.pdf"`, "Cache-Control": "private, no-store" },
  });
});
