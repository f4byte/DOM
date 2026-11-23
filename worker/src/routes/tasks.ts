import { Hono } from "hono";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "../../../shared/constants";
import { isValidDate } from "../../../shared/time";
import type { TaskActivityDTO } from "../../../shared/types";
import type { AppEnv } from "../env";
import { badRequest, parseBody, parseId } from "../lib/http";
import { duplicateTask, getTaskRow, insertTask, softDeleteTask, toTaskDTO, updateTask, type TaskRow } from "../lib/tasks";
import { taskCreateSchema, taskUpdateSchema } from "../lib/validation";

export const tasks = new Hono<AppEnv>();

const PRIORITY_SQL = "CASE priority WHEN 'Urgent' THEN 3 WHEN 'High' THEN 2 WHEN 'Medium' THEN 1 ELSE 0 END";
const STATUS_SQL = "CASE status WHEN 'Blocked' THEN 0 WHEN 'On Hold' THEN 1 WHEN 'Not Started' THEN 2 WHEN 'In Progress' THEN 3 WHEN 'Under Review' THEN 4 ELSE 5 END";
const SORTS: Record<string, string> = {
  code: "seq",
  title: "title COLLATE NOCASE",
  category: "category",
  assignedDate: "assigned_date",
  startTime: "(start_time IS NULL), start_time",
  deadline: "(deadline IS NULL), deadline",
  priority: PRIORITY_SQL,
  status: STATUS_SQL,
  estimatedMinutes: "(estimated_minutes IS NULL), estimated_minutes",
  actualMinutes: "(actual_minutes IS NULL), actual_minutes",
  progressPercent: "progress_percent",
  completedAt: "(completed_at IS NULL), completed_at",
  updatedAt: "updated_at",
  createdAt: "created_at",
};

const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
const csv = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

tasks.get("/", async (c) => {
  const q = c.req.query();
  const user = c.get("user");
  const where = ["user_id = ?", "deleted_at IS NULL"];
  const params: unknown[] = [user.id];

  for (const [key, col] of [["date", "="], ["from", ">="], ["to", "<="]] as const) {
    if (q[key]) {
      if (!isValidDate(q[key])) throw badRequest(`Invalid ${key} (YYYY-MM-DD)`);
      where.push(`assigned_date ${col} ?`);
      params.push(q[key]);
    }
  }
  const enumFilter = (name: string, col: string, allowed: readonly string[]) => {
    const vals = csv(q[name]).filter((v) => allowed.includes(v));
    if (csv(q[name]).length && !vals.length) throw badRequest(`Invalid ${name} filter`);
    if (vals.length) {
      where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
      params.push(...vals);
    }
  };
  enumFilter("category", "category", TASK_CATEGORIES);
  enumFilter("status", "status", TASK_STATUSES);
  enumFilter("priority", "priority", TASK_PRIORITIES);

  const search = (q.q ?? "").trim().slice(0, 100);
  if (search) {
    where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR implementation_notes LIKE ? ESCAPE '\\' OR task_code LIKE ? ESCAPE '\\')");
    const p = likeEscape(search);
    params.push(p, p, p, p);
  }
  if (q.overdue === "1") {
    where.push("deadline IS NOT NULL AND deadline < ? AND status != 'Completed'");
    params.push(new Date().toISOString());
  }

  const sortCol = SORTS[q.sort ?? ""] ?? null;
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const order = sortCol ? `ORDER BY ${sortCol} ${dir}, seq ASC` : "ORDER BY assigned_date DESC, seq ASC";
  const limit = Math.min(Math.max(Number(q.limit) || 1000, 1), 2000);

  const { results } = await c.env.DB.prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ${order} LIMIT ${limit}`).bind(...params).all<TaskRow>();
  const now = new Date();
  return c.json({ tasks: results.map((r) => toTaskDTO(r, now)), total: results.length });
});

tasks.post("/", async (c) => {
  const body = await parseBody(c, taskCreateSchema);
  const user = c.get("user");
  const id = await insertTask(c.env.DB, user.id, body);
  return c.json({ task: toTaskDTO(await getTaskRow(c.env.DB, user.id, id)) }, 201);
});

tasks.get("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const row = await getTaskRow(c.env.DB, user.id, id);
  const { results } = await c.env.DB.prepare(
    "SELECT id, action, field, old_value, new_value, created_at FROM task_activity_logs WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200",
  )
    .bind(id, user.id)
    .all<{ id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string }>();
  const activity: TaskActivityDTO[] = results.map((r) => ({ id: r.id, action: r.action, field: r.field, oldValue: r.old_value, newValue: r.new_value, createdAt: r.created_at }));
  return c.json({ task: toTaskDTO(row), activity });
});

tasks.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = parseId(c.req.param("id"));
  const patch = await parseBody(c, taskUpdateSchema);
  return c.json({ task: toTaskDTO(await updateTask(c.env.DB, user.id, id, patch)) });
});

tasks.delete("/:id", async (c) => {
  await softDeleteTask(c.env.DB, c.get("user").id, parseId(c.req.param("id")));
  return c.json({ ok: true });
});

tasks.post("/:id/duplicate", async (c) => {
  const user = c.get("user");
  const newId = await duplicateTask(c.env.DB, user.id, parseId(c.req.param("id")));
  return c.json({ task: toTaskDTO(await getTaskRow(c.env.DB, user.id, newId)) }, 201);
});
