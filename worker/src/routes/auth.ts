import { Hono } from "hono";
import type { AppEnv } from "../env";
import { authenticate, endSession, resolveSession, startSession } from "../lib/auth";
import { hashPassword, secretsMatch, verifyPassword } from "../lib/crypto";
import { ApiError, badRequest, clientIp, forbidden, parseBody } from "../lib/http";
import { insertTask } from "../lib/tasks";
import { changePasswordSchema, loginSchema, setupSchema } from "../lib/validation";

export const auth = new Hono<AppEnv>();

const MAX_FAILS_PER_IDENTIFIER = 8;
const MAX_FAILS_PER_IP = 25;
const WINDOW_MIN = 15;

// Verified against when the email is unknown so response time doesn't reveal which accounts exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-for-timing"));

auth.get("/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  const s = await resolveSession(c);
  return c.json({
    setupRequired: (row?.n ?? 0) === 0,
    setupKeyRequired: !!c.env.SETUP_KEY,
    authenticated: !!s,
    user: s?.user ?? null,
  });
});

/** First-run only: creates the single intern account (and the two initial tasks). */
auth.post("/setup", async (c) => {
  const body = await parseBody(c, setupSchema);
  if (c.env.SETUP_KEY) {
    if (!body.setupKey || !(await secretsMatch(body.setupKey, c.env.SETUP_KEY))) throw forbidden("Invalid setup key");
  }
  const hash = await hashPassword(body.password);
  const ins = await c.env.DB.prepare("INSERT INTO users (email, password_hash, role) SELECT ?, ?, 'intern' WHERE NOT EXISTS (SELECT 1 FROM users)")
    .bind(body.email, hash)
    .run();
  if (!ins.meta.changes) throw forbidden("Setup has already been completed. Please sign in.");
  const userId = ins.meta.last_row_id as number;

  await c.env.DB.prepare("INSERT INTO profiles (user_id, full_name, employment_type, mentor_name) VALUES (?, ?, 'IT Intern', ?)")
    .bind(userId, body.fullName, body.mentorName ?? "")
    .run();

  // The two starting tasks requested for this project; fully editable like any other task.
  await insertTask(c.env.DB, userId, {
    title: "Task Management SaaS",
    description: "Develop a task management SaaS application with frontend, backend, and database integration.",
    category: "Full-stack Development",
    priority: "High",
    status: "In Progress",
  });
  await insertTask(c.env.DB, userId, {
    title: "Cloudflare Deployment with D1",
    description: "Deploy the application to Cloudflare infrastructure and integrate Cloudflare D1 as the SQLite database.",
    category: "Deployment",
    priority: "High",
    status: "Not Started",
  });

  await startSession(c, userId);
  return c.json({ user: { id: userId, email: body.email, role: "intern", fullName: body.fullName } }, 201);
});

auth.post("/login", async (c) => {
  const { email, password } = await parseBody(c, loginSchema);
  const db = c.env.DB;
  const ip = clientIp(c);
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  const [byId, byIp] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND success = 0 AND created_at > ?").bind(email, since).first<{ n: number }>(),
    ip ? db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?").bind(ip, since).first<{ n: number }>() : Promise.resolve({ n: 0 }),
  ]);
  if ((byId?.n ?? 0) >= MAX_FAILS_PER_IDENTIFIER || (byIp?.n ?? 0) >= MAX_FAILS_PER_IP) {
    throw new ApiError(429, `Too many failed attempts. Try again in ${WINDOW_MIN} minutes.`, "rate_limited");
  }

  const user = await db.prepare("SELECT id, password_hash, is_active FROM users WHERE email = ?").bind(email).first<{ id: number; password_hash: string; is_active: number }>();
  const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await getDummyHash()), false);

  await db.prepare("INSERT INTO login_attempts (identifier, ip, success) VALUES (?, ?, ?)").bind(email, ip, ok && user?.is_active ? 1 : 0).run();
  await db.prepare("DELETE FROM login_attempts WHERE created_at < ?").bind(new Date(Date.now() - 24 * 3_600_000).toISOString()).run();

  if (!user || !ok || !user.is_active) throw new ApiError(401, "Incorrect email or password", "invalid_credentials");
  await startSession(c, user.id);

  const me = await db
    .prepare("SELECT u.id, u.email, u.role, p.full_name AS fullName FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?")
    .bind(user.id)
    .first();
  return c.json({ user: me });
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get("/me", authenticate, async (c) => c.json({ user: c.get("user") }));

auth.post("/change-password", authenticate, async (c) => {
  const { currentPassword, newPassword } = await parseBody(c, changePasswordSchema);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) throw badRequest("Current password is incorrect");
  const hash = await hashPassword(newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(hash, new Date().toISOString(), user.id),
    // Sign out every other session.
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(user.id, c.get("sessionId")),
  ]);
  return c.json({ ok: true });
});
