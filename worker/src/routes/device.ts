// Android automation integration.
//   • POST /api/device/event   — webhook called by Tasker / MacroDroid (Bearer device token, no cookies)
//   • /api/device/tokens       — token management for the signed-in user
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { authenticate, internOnly } from "../lib/auth";
import { randomToken, sha256Hex } from "../lib/crypto";
import { ApiError, badRequest, notFound, parseBody, parseId, parseWith } from "../lib/http";
import { normalizeTimestamp, processDeviceEvent } from "../lib/device-events";
import { getSettings } from "../lib/settings";
import { deviceEventSchema, deviceTokenCreateSchema } from "../lib/validation";

export const device = new Hono<AppEnv>();

/** Accept JSON or form-encoded bodies (some automation apps only send forms). */
async function readEventBody(c: { req: { header: (n: string) => string | undefined; json: () => Promise<unknown>; parseBody: () => Promise<Record<string, unknown>> } }) {
  const type = (c.req.header("Content-Type") ?? "").toLowerCase();
  try {
    if (type.includes("application/json")) return await c.req.json();
    if (type.includes("form")) return await c.req.parseBody();
  } catch {
    /* fall through */
  }
  throw badRequest('Send a JSON body such as {"event":"unlock"} with Content-Type: application/json');
}

device.post("/event", async (c) => {
  const header = c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) throw new ApiError(401, "Missing bearer token", "unauthenticated");
  const hash = await sha256Hex(m[1]);
  const tok = await c.env.DB.prepare(
    `SELECT t.id, t.user_id FROM device_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.is_active = 1 AND u.role IN ('intern','admin')`,
  )
    .bind(hash)
    .first<{ id: number; user_id: number }>();
  if (!tok) throw new ApiError(401, "Invalid or revoked token", "unauthenticated");

  const raw = await readEventBody(c);
  const body = parseWith(deviceEventSchema, raw);
  const occurredAt = normalizeTimestamp(body.timestamp);
  await c.env.DB.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), tok.id).run();

  const settings = await getSettings(c.env.DB, tok.user_id);
  if (!settings.automationEnabled) {
    return c.json({ ok: true, accepted: false, status: "ignored", reason: "automation_disabled" });
  }
  const result = await processDeviceEvent(c.env.DB, tok.user_id, settings, { type: body.event, occurredAt, device: body.device, raw: { event: body.event, timestamp: body.timestamp ?? null, device: body.device ?? null } });
  return c.json({ ok: true, ...result });
});

// ---- token management (session auth) ----
device.get("/tokens", authenticate, internOnly, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, label, token_prefix, last_used_at, created_at, revoked_at FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC")
    .bind(c.get("user").id)
    .all<{ id: number; label: string; token_prefix: string; last_used_at: string | null; created_at: string; revoked_at: string | null }>();
  return c.json({ tokens: results.map((t) => ({ id: t.id, label: t.label, prefix: t.token_prefix, lastUsedAt: t.last_used_at, createdAt: t.created_at, revokedAt: t.revoked_at })) });
});

device.post("/tokens", authenticate, internOnly, async (c) => {
  const user = c.get("user");
  const { label } = await parseBody(c, deviceTokenCreateSchema);
  const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL").bind(user.id).first<{ n: number }>();
  if ((active?.n ?? 0) >= 10) throw badRequest("You can have at most 10 active device tokens. Revoke one first.");
  const token = `pims_${randomToken(32)}`;
  const res = await c.env.DB.prepare("INSERT INTO device_tokens (user_id, label, token_hash, token_prefix) VALUES (?, ?, ?, ?)")
    .bind(user.id, label, await sha256Hex(token), token.slice(0, 10))
    .run();
  // The raw token is returned exactly once; only its hash is stored.
  return c.json({ id: res.meta.last_row_id, label, token }, 201);
});

device.delete("/tokens/:id", authenticate, internOnly, async (c) => {
  const id = parseId(c.req.param("id"));
  const res = await c.env.DB.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), id, c.get("user").id)
    .run();
  if (!res.meta.changes) throw notFound("Token not found");
  return c.json({ ok: true });
});
