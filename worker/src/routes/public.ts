// Unauthenticated, read-only access to a *submitted* report via its secret share token.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { resolveSession } from "../lib/auth";
import { notFound } from "../lib/http";
import { latestSubmittedInfo, loadReviews, markViewed, toReportDTO, type ReportRow } from "../lib/reports";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/reports/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound("Report not found");
  let r = await c.env.DB.prepare(
    "SELECT r.*, p.full_name AS intern_name FROM daily_reports r JOIN profiles p ON p.user_id = r.user_id WHERE r.share_token = ? AND r.status != 'draft'",
  )
    .bind(token)
    .first<ReportRow>();
  if (!r) throw notFound("Report not found or not yet submitted");

  // The author previewing their own link must not flip the status to "viewed".
  const session = await resolveSession(c);
  if (!session || session.user.id !== r.user_id) {
    r = await markViewed(c.env.DB, r, { userId: session?.user.id ?? null, name: session?.user.fullName ?? "Shared link" });
  }
  const reviews = await loadReviews(c.env.DB, r.id);
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.json({ report: toReportDTO(r, reviews), reviews, latest: await latestSubmittedInfo(c.env.DB, r) });
});
