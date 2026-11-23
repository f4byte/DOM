import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env";
import { authenticate, internOnly, requireRole } from "./lib/auth";
import { ApiError, forbidden } from "./lib/http";
import { attendance } from "./routes/attendance";
import { auth } from "./routes/auth";
import { analytics, dashboard } from "./routes/dashboard";
import { device } from "./routes/device";
import { devlogs } from "./routes/devlogs";
import { exportRoutes } from "./routes/export";
import { publicRoutes } from "./routes/public";
import { reports } from "./routes/reports";
import { settingsRoutes } from "./routes/settings";
import { tasks } from "./routes/tasks";
import { tl } from "./routes/tl";

const app = new Hono<AppEnv>();

// ---- global API middleware: CSRF origin check + security headers ----
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin) {
      const allowed = [new URL(c.req.url).origin, ...(c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
      if (!allowed.includes(origin)) throw forbidden("Cross-origin request blocked");
    }
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
});

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME ?? "DOM", time: new Date().toISOString() }));

// ---- public / self-authenticating ----
app.route("/api/auth", auth);
app.route("/api/device", device); // POST /event uses a bearer device token; /tokens uses the session
app.route("/api/public", publicRoutes);

// ---- intern (owner) endpoints ----
for (const base of ["tasks", "attendance", "devlogs", "reports", "settings", "dashboard", "analytics", "export"]) {
  app.use(`/api/${base}`, authenticate, internOnly);
  app.use(`/api/${base}/*`, authenticate, internOnly);
}
app.route("/api/tasks", tasks);
app.route("/api/attendance", attendance);
app.route("/api/devlogs", devlogs);
app.route("/api/reports", reports);
app.route("/api/settings", settingsRoutes);
app.route("/api/dashboard", dashboard);
app.route("/api/analytics", analytics);
app.route("/api/export", exportRoutes);

// ---- TL (read-only reviewer) endpoints ----
app.use("/api/tl/*", authenticate, requireRole("tl"));
app.route("/api/tl", tl);

app.all("/api/*", () => {
  throw new ApiError(404, "Unknown API endpoint", "not_found");
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code ?? "error", message: err.message, details: err.details } }, err.status as 400);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("Unhandled error", err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong on the server" } }, 500);
});

// Anything that isn't /api is served by Workers Static Assets (this is a fallback for completeness).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
