import { Hono } from "hono";
import { DEV_AREAS } from "../../../shared/constants";
import { isValidDate, localDate } from "../../../shared/time";
import type { DevLogDTO } from "../../../shared/types";
import type { AppEnv } from "../env";
import { badRequest, notFound, parseBody, parseId } from "../lib/http";
import { devLogCreateSchema, devLogUpdateSchema } from "../lib/validation";

export const devlogs = new Hono<AppEnv>();

interface Row {
  id: number;
  log_date: string;
  area: string;
  task_id: number | null;
  task_code: string | null;
  task_title: string | null;
  implemented: string;
  technologies: string;
  problems: string;
  solutions: string;
  status: DevLogDTO["status"];
  next_plan: string;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT d.*, t.task_code, t.title AS task_title FROM dev_logs d LEFT JOIN tasks t ON t.id = d.task_id`;

const toDTO = (r: Row): DevLogDTO => ({
  id: r.id,
  logDate: r.log_date,
  area: r.area,
  taskId: r.task_id,
  taskCode: r.task_code,
  taskTitle: r.task_title,
  implemented: r.implemented,
  technologies: r.technologies,
  problems: r.problems,
  solutions: r.solutions,
  status: r.status,
  nextPlan: r.next_plan,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

async function assertTaskOwned(db: D1Database, userId: number, taskId: number | null | undefined) {
  if (!taskId) return;
  const t = await db.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(taskId, userId).first();
  if (!t) throw badRequest("Linked task not found");
}

devlogs.get("/", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const where = ["d.user_id = ?"];
  const params: unknown[] = [user.id];
  for (const [key, op] of [["date", "="], ["from", ">="], ["to", "<="]] as const) {
    if (q[key]) {
      if (!isValidDate(q[key])) throw badRequest(`Invalid ${key}`);
      where.push(`d.log_date ${op} ?`);
      params.push(q[key]);
    }
  }
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.log_date DESC, d.id ASC LIMIT 500`).bind(...params).all<Row>();
  return c.json({ logs: results.map(toDTO) });
});

/** Daily development summary: entries grouped by area, plus roll-ups for technologies, problems and next steps. */
devlogs.get("/summary", async (c) => {
  const user = c.get("user");
  const date = c.req.query("date") ?? localDate(new Date());
  if (!isValidDate(date)) throw badRequest("Invalid date");
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE d.user_id = ? AND d.log_date = ? ORDER BY d.id`).bind(user.id, date).all<Row>();
  const logs = results.map(toDTO);
  const byArea = DEV_AREAS.map((area) => {
    const items = logs.filter((l) => l.area === area);
    return { area, count: items.length, completed: items.filter((l) => l.status === "Completed").length, items };
  }).filter((g) => g.count > 0);
  const technologies = [...new Set(logs.flatMap((l) => l.technologies.split(",").map((s) => s.trim()).filter(Boolean)))];
  return c.json({
    date,
    totalEntries: logs.length,
    byArea,
    technologies,
    problems: logs.filter((l) => l.problems).map((l) => ({ area: l.area, problem: l.problems, solution: l.solutions })),
    nextSteps: logs.flatMap((l) => l.nextPlan.split("\n").map((s) => s.trim()).filter(Boolean)),
  });
});

devlogs.post("/", async (c) => {
  const user = c.get("user");
  const b = await parseBody(c, devLogCreateSchema);
  await assertTaskOwned(c.env.DB, user.id, b.taskId);
  const res = await c.env.DB.prepare(
    `INSERT INTO dev_logs (user_id, log_date, area, task_id, implemented, technologies, problems, solutions, status, next_plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, b.logDate, b.area, b.taskId ?? null, b.implemented ?? "", b.technologies ?? "", b.problems ?? "", b.solutions ?? "", b.status ?? "In Progress", b.nextPlan ?? "")
    .run();
  const row = await c.env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(res.meta.last_row_id).first<Row>();
  return c.json({ log: toDTO(row!) }, 201);
});

const COLS: Record<string, string> = {
  logDate: "log_date",
  area: "area",
  taskId: "task_id",
  implemented: "implemented",
  technologies: "technologies",
  problems: "problems",
  solutions: "solutions",
  status: "status",
  nextPlan: "next_plan",
};

devlogs.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const patch = await parseBody(c, devLogUpdateSchema);
  const existing = await c.env.DB.prepare("SELECT id FROM dev_logs WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!existing) throw notFound("Log entry not found");
  await assertTaskOwned(c.env.DB, user.id, patch.taskId);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (COLS[k] && v !== undefined) {
      sets.push(`${COLS[k]} = ?`);
      vals.push(v);
    }
  }
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id, user.id);
  await c.env.DB.prepare(`UPDATE dev_logs SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(id).first<Row>();
  return c.json({ log: toDTO(row!) });
});

devlogs.delete("/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM dev_logs WHERE id = ? AND user_id = ?").bind(parseId(c.req.param("id")), c.get("user").id).run();
  if (!res.meta.changes) throw notFound("Log entry not found");
  return c.json({ ok: true });
});
