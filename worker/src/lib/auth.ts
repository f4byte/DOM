import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Role } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { ApiError, clientIp } from "./http";

export const SESSION_COOKIE = "pims_session";
const HOUR = 3_600_000;

function ttlMs(c: Context<AppEnv>): number {
  const days = Number(c.env.SESSION_TTL_DAYS ?? "30");
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * HOUR;
}

function cookieOpts(c: Context<AppEnv>, maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

/** Create a session row and set the cookie. The raw token only ever lives in the cookie. */
export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const ttl = ttlMs(c);
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, userId, new Date(now).toISOString(), new Date(now + ttl).toISOString(), new Date(now).toISOString(), (c.req.header("User-Agent") ?? "").slice(0, 200), clientIp(c))
    .run();
  // Opportunistic cleanup of expired sessions.
  await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date(now).toISOString()).run();
  setCookie(c, SESSION_COOKIE, token, cookieOpts(c, Math.floor(ttl / 1000)));
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

interface SessionRow {
  expires_at: string;
  last_seen_at: string;
  uid: number;
  email: string;
  role: Role;
  is_active: number;
  full_name: string | null;
}

/** Resolve the cookie to a user, or null. Slides the session expiry at most once per hour. */
export async function resolveSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const sid = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.expires_at, s.last_seen_at, u.id AS uid, u.email, u.role, u.is_active, p.full_name
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = u.id
      WHERE s.id = ?`,
  )
    .bind(sid)
    .first<SessionRow>();
  const now = Date.now();
  if (!row || !row.is_active || new Date(row.expires_at).getTime() < now) return null;
  if (now - new Date(row.last_seen_at).getTime() > HOUR) {
    const ttl = ttlMs(c);
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(new Date(now).toISOString(), new Date(now + ttl).toISOString(), sid)
      .run();
    setCookie(c, SESSION_COOKIE, token, cookieOpts(c, Math.floor(ttl / 1000)));
  }
  return { sid, user: { id: row.uid, email: row.email, role: row.role, fullName: row.full_name ?? row.email } };
}

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await resolveSession(c);
  if (!s) throw new ApiError(401, "Please sign in", "unauthenticated");
  c.set("user", s.user);
  c.set("sessionId", s.sid);
  await next();
};

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!roles.includes(c.get("user").role)) throw new ApiError(403, "You do not have access to this resource", "forbidden");
    await next();
  };

/** Intern-owned data endpoints (admins are allowed too for future multi-user support). */
export const internOnly = requireRole("intern", "admin");
