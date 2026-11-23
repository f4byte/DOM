import { Hono } from "hono";
import { TIMEZONE } from "../../../shared/constants";
import { parseHHMM } from "../../../shared/time";
import type { DeviceTokenDTO, SettingsResponse } from "../../../shared/types";
import type { AppEnv } from "../env";
import { hashPassword } from "../lib/crypto";
import { badRequest, conflict, parseBody } from "../lib/http";
import { getSettings, saveSettings } from "../lib/settings";
import { settingsUpdateSchema, tlCreateSchema } from "../lib/validation";

export const settingsRoutes = new Hono<AppEnv>();

async function buildResponse(c: { env: AppEnv["Bindings"] }, userId: number): Promise<SettingsResponse> {
  const db = c.env.DB;
  const [profile, settings, tokens] = await Promise.all([
    db
      .prepare(
        `SELECT u.email, u.role, p.full_name, p.employment_type, p.mentor_name, p.mentor_user_id,
                tl.email AS tl_email, tlp.full_name AS tl_name
           FROM users u JOIN profiles p ON p.user_id = u.id
           LEFT JOIN users tl ON tl.id = p.mentor_user_id LEFT JOIN profiles tlp ON tlp.user_id = tl.id
          WHERE u.id = ?`,
      )
      .bind(userId)
      .first<{ email: string; role: "intern" | "tl" | "admin"; full_name: string; employment_type: string; mentor_name: string | null; mentor_user_id: number | null; tl_email: string | null; tl_name: string | null }>(),
    getSettings(db, userId),
    db
      .prepare("SELECT id, label, token_prefix, last_used_at, created_at, revoked_at FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all<{ id: number; label: string; token_prefix: string; last_used_at: string | null; created_at: string; revoked_at: string | null }>(),
  ]);
  const p = profile!;
  const deviceTokens: DeviceTokenDTO[] = tokens.results.map((t) => ({ id: t.id, label: t.label, prefix: t.token_prefix, lastUsedAt: t.last_used_at, createdAt: t.created_at, revokedAt: t.revoked_at }));
  return {
    profile: { fullName: p.full_name, email: p.email, employmentType: p.employment_type, mentorName: p.mentor_name ?? "", role: p.role },
    settings,
    tl: p.mentor_user_id ? { id: p.mentor_user_id, name: p.tl_name ?? "", email: p.tl_email ?? "" } : null,
    deviceTokens,
    meta: { r2Enabled: !!c.env.ATTACHMENTS, appName: c.env.APP_NAME ?? "DOM", timezone: TIMEZONE },
  };
}

settingsRoutes.get("/", async (c) => c.json(await buildResponse(c, c.get("user").id)));

settingsRoutes.put("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, settingsUpdateSchema);
  const current = await getSettings(c.env.DB, user.id);

  if (body.settings) {
    const merged = { ...current, ...body.settings };
    if (parseHHMM(merged.officeEnd) <= parseHHMM(merged.officeStart)) throw badRequest("Office end must be after office start");
    if (parseHHMM(merged.loginWindowEnd) <= parseHHMM(merged.loginWindowStart)) throw badRequest("Login window end must be after its start");
    merged.workingDays = [...new Set(merged.workingDays)].sort();
    await saveSettings(c.env.DB, user.id, { ...body.settings, workingDays: merged.workingDays });
  }
  if (body.profile) {
    const p = body.profile;
    await c.env.DB.prepare(
      `UPDATE profiles SET full_name = COALESCE(?, full_name), mentor_name = COALESCE(?, mentor_name),
              employment_type = COALESCE(?, employment_type), updated_at = ? WHERE user_id = ?`,
    )
      .bind(p.fullName ?? null, p.mentorName ?? null, p.employmentType ?? null, new Date().toISOString(), user.id)
      .run();
  }
  return c.json(await buildResponse(c, user.id));
});

/** Create a read-only TL account linked to this intern (so the mentor can review reports). */
settingsRoutes.post("/tl", async (c) => {
  const user = c.get("user");
  const body = await parseBody(c, tlCreateSchema);
  const me = await c.env.DB.prepare("SELECT mentor_user_id FROM profiles WHERE user_id = ?").bind(user.id).first<{ mentor_user_id: number | null }>();
  if (me?.mentor_user_id) throw conflict("A TL account is already linked. Unlink it first.");
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(body.email).first();
  if (exists) throw conflict("That email is already in use");

  const hash = await hashPassword(body.password);
  const ins = await c.env.DB.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'tl')").bind(body.email, hash).run();
  const tlId = ins.meta.last_row_id as number;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO profiles (user_id, full_name, employment_type) VALUES (?, ?, 'Team Leader')").bind(tlId, body.name),
    c.env.DB.prepare("UPDATE profiles SET mentor_user_id = ?, mentor_name = ?, updated_at = ? WHERE user_id = ?").bind(tlId, body.name, new Date().toISOString(), user.id),
  ]);
  return c.json(await buildResponse(c, user.id), 201);
});

settingsRoutes.delete("/tl", async (c) => {
  const user = c.get("user");
  const me = await c.env.DB.prepare("SELECT mentor_user_id FROM profiles WHERE user_id = ?").bind(user.id).first<{ mentor_user_id: number | null }>();
  if (!me?.mentor_user_id) throw badRequest("No TL account is linked");
  const tlId = me.mentor_user_id;
  await c.env.DB.prepare("UPDATE profiles SET mentor_user_id = NULL, updated_at = ? WHERE user_id = ?").bind(new Date().toISOString(), user.id).run();
  const others = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM profiles WHERE mentor_user_id = ?").bind(tlId).first<{ n: number }>();
  if (!others?.n) {
    // No interns left → disable the TL login and end its sessions.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ? AND role = 'tl'").bind(tlId),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(tlId),
    ]);
  }
  return c.json(await buildResponse(c, user.id));
});
