import type { z } from "zod";
import type { TaskDTO } from "../../../shared/types";
import { localDate } from "../../../shared/time";
import type { taskCreateSchema, taskUpdateSchema } from "./validation";
import { notFound } from "./http";

export interface TaskRow {
  id: number;
  user_id: number;
  seq: number;
  task_code: string;
  title: string;
  description: string;
  category: string;
  assigned_date: string;
  start_time: string | null;
  deadline: string | null;
  priority: TaskDTO["priority"];
  status: TaskDTO["status"];
  estimated_minutes: number | null;
  actual_minutes: number | null;
  progress_percent: number;
  implementation_notes: string;
  blockers: string;
  completed_at: string | null;
  reference_url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

/** camelCase field → column. Only these can be written through the API. */
export const TASK_FIELDS: Record<string, keyof TaskRow> = {
  title: "title",
  description: "description",
  category: "category",
  assignedDate: "assigned_date",
  startTime: "start_time",
  deadline: "deadline",
  priority: "priority",
  status: "status",
  estimatedMinutes: "estimated_minutes",
  actualMinutes: "actual_minutes",
  progressPercent: "progress_percent",
  implementationNotes: "implementation_notes",
  blockers: "blockers",
  completedAt: "completed_at",
  referenceUrl: "reference_url",
};

export function toTaskDTO(r: TaskRow, now = new Date()): TaskDTO {
  return {
    id: r.id,
    code: r.task_code,
    title: r.title,
    description: r.description,
    category: r.category,
    assignedDate: r.assigned_date,
    startTime: r.start_time,
    deadline: r.deadline,
    priority: r.priority,
    status: r.status,
    estimatedMinutes: r.estimated_minutes,
    actualMinutes: r.actual_minutes,
    progressPercent: r.progress_percent,
    implementationNotes: r.implementation_notes,
    blockers: r.blockers,
    completedAt: r.completed_at,
    referenceUrl: r.reference_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isOverdue: !!r.deadline && r.status !== "Completed" && new Date(r.deadline).getTime() < now.getTime(),
  };
}

export async function getTaskRow(db: D1Database, userId: number, id: number): Promise<TaskRow> {
  const row = await db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(id, userId).first<TaskRow>();
  if (!row) throw notFound("Task not found");
  return row;
}

function logStmt(db: D1Database, taskId: number, userId: number, action: string, field: string | null, oldV: unknown, newV: unknown, at: string) {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return db
    .prepare("INSERT INTO task_activity_logs (task_id, user_id, action, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(taskId, userId, action, field, s(oldV), s(newV), at);
}

/** Insert a task with an auto-generated per-user ID (TSK-0001 …). Returns the new row id. */
export async function insertTask(db: D1Database, userId: number, d: TaskCreateInput, action: "created" | "duplicated" = "created"): Promise<number> {
  const now = new Date().toISOString();
  const status = d.status ?? "Not Started";
  const completedAt = d.completedAt ?? (status === "Completed" ? now : null);
  const progress = d.progressPercent ?? (status === "Completed" ? 100 : 0);
  const startTime = d.startTime ?? (status === "In Progress" ? now : null);
  const res = await db
    .prepare(
      `INSERT INTO tasks (user_id, seq, task_code, title, description, category, assigned_date, start_time, deadline, priority, status,
                          estimated_minutes, actual_minutes, progress_percent, implementation_notes, blockers, completed_at, reference_url,
                          created_at, updated_at)
       SELECT ?, n, 'TSK-' || printf('%04d', n), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tasks WHERE user_id = ?)`,
    )
    .bind(
      userId,
      d.title,
      d.description ?? "",
      d.category ?? "Other",
      d.assignedDate ?? localDate(now),
      startTime,
      d.deadline ?? null,
      d.priority ?? "Medium",
      status,
      d.estimatedMinutes ?? null,
      d.actualMinutes ?? null,
      progress,
      d.implementationNotes ?? "",
      d.blockers ?? "",
      completedAt,
      d.referenceUrl ?? null,
      now,
      now,
      userId,
    )
    .run();
  const id = res.meta.last_row_id as number;
  await logStmt(db, id, userId, action, null, null, d.title, now).run();
  return id;
}

/** Apply a partial update, enforce status side-effects, and write one history row per changed field. */
export async function updateTask(db: D1Database, userId: number, id: number, patch: TaskUpdateInput): Promise<TaskRow> {
  const existing = await getTaskRow(db, userId, id);
  const now = new Date().toISOString();
  const next: Record<string, unknown> = { ...patch };

  if (patch.status && patch.status !== existing.status) {
    if (patch.status === "Completed") {
      if (patch.completedAt === undefined) next.completedAt = now;
      if (patch.progressPercent === undefined) next.progressPercent = 100;
    } else if (existing.status === "Completed" && patch.completedAt === undefined) {
      next.completedAt = null;
    }
    if (patch.status === "In Progress" && !existing.start_time && patch.startTime === undefined) next.startTime = now;
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const logs: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(next)) {
    const col = TASK_FIELDS[key];
    if (!col || value === undefined) continue;
    const oldV = existing[col];
    if ((oldV ?? null) === (value ?? null)) continue;
    sets.push(`${col} = ?`);
    values.push(value ?? null);
    logs.push(logStmt(db, id, userId, col === "status" ? "status_changed" : "updated", col, oldV, value, now));
  }
  if (sets.length === 0) return existing;
  sets.push("updated_at = ?");
  values.push(now, id, userId);
  await db.batch([db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...values), ...logs]);
  return getTaskRow(db, userId, id);
}

export async function softDeleteTask(db: D1Database, userId: number, id: number): Promise<void> {
  await getTaskRow(db, userId, id);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(now, now, id, userId),
    logStmt(db, id, userId, "deleted", null, null, null, now),
  ]);
}

export async function duplicateTask(db: D1Database, userId: number, id: number): Promise<number> {
  const t = await getTaskRow(db, userId, id);
  return insertTask(
    db,
    userId,
    {
      title: `${t.title} (copy)`.slice(0, 200),
      description: t.description,
      category: t.category as TaskCreateInput["category"],
      assignedDate: t.assigned_date,
      deadline: t.deadline,
      priority: t.priority,
      status: "Not Started",
      estimatedMinutes: t.estimated_minutes,
      actualMinutes: null,
      progressPercent: 0,
      implementationNotes: "",
      blockers: "",
      completedAt: null,
      startTime: null,
      referenceUrl: t.reference_url,
    },
    "duplicated",
  );
}

/** Tasks relevant to a given local day: assigned that day, completed that day, or still open from earlier. */
export function inDayScope(t: TaskRow, date: string): boolean {
  if (t.assigned_date === date) return true;
  if (t.completed_at && localDate(t.completed_at) === date) return true;
  return t.status !== "Completed" && t.assigned_date < date;
}
