import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "@shared/constants";
import { localDateTimeToUtcIso, utcIsoToLocalDateTime, formatDuration } from "@shared/time";
import type { TaskDTO } from "@shared/types";
import { StatusBadge } from "@/components/badges";
import { Badge, Button, ConfirmDialog, ErrorState, Field, Input, Modal, PageLoader, Select, Tabs, Textarea } from "@/components/ui";
import { useTask, useTaskActions, type TaskPatch } from "@/hooks/use-tasks";
import { dateTimeOf } from "@/lib/format";
import { parseDuration } from "@/lib/utils";

interface Form {
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedDate: string;
  startTime: string;
  deadline: string;
  completedAt: string;
  estimate: string;
  actual: string;
  progress: string;
  referenceUrl: string;
  implementationNotes: string;
  blockers: string;
}

const dur = (m: number | null) => (m == null ? "" : formatDuration(m));
const local = (iso: string | null) => (iso ? utcIsoToLocalDateTime(iso) : "");

const toForm = (t: TaskDTO): Form => ({
  title: t.title,
  description: t.description,
  category: t.category,
  priority: t.priority,
  status: t.status,
  assignedDate: t.assignedDate,
  startTime: local(t.startTime),
  deadline: local(t.deadline),
  completedAt: local(t.completedAt),
  estimate: dur(t.estimatedMinutes),
  actual: dur(t.actualMinutes),
  progress: String(t.progressPercent),
  referenceUrl: t.referenceUrl ?? "",
  implementationNotes: t.implementationNotes,
  blockers: t.blockers,
});

/** Build a PATCH containing only the fields the user actually changed. Throws a readable Error on invalid input. */
function diff(t: TaskDTO, f: Form): TaskPatch {
  const orig = toForm(t);
  const p: Record<string, unknown> = {};
  const changed = (k: keyof Form) => f[k] !== orig[k];
  if (changed("title")) {
    if (!f.title.trim()) throw new Error("Title is required");
    p.title = f.title.trim();
  }
  for (const k of ["description", "implementationNotes", "blockers"] as const) if (changed(k)) p[k] = f[k];
  for (const k of ["category", "priority", "status", "assignedDate"] as const) if (changed(k)) p[k] = f[k];
  for (const k of ["startTime", "deadline", "completedAt"] as const) if (changed(k)) p[k] = f[k] ? localDateTimeToUtcIso(f[k]) : null;
  for (const [k, key, label] of [
    ["estimate", "estimatedMinutes", "Estimated duration"],
    ["actual", "actualMinutes", "Actual duration"],
  ] as const) {
    if (!changed(k)) continue;
    const v = parseDuration(f[k]);
    if (Number.isNaN(v)) throw new Error(`${label}: use e.g. "90", "1h 30m" or "2h"`);
    p[key] = v;
  }
  if (changed("progress")) {
    const n = Number(f.progress);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error("Progress must be a whole number from 0 to 100");
    p.progressPercent = n;
  }
  if (changed("referenceUrl")) p.referenceUrl = f.referenceUrl.trim() || null;
  return p as TaskPatch;
}

/** Right-hand drawer with every task field plus the change history. */
export function TaskDrawer({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const q = useTask(taskId);
  const { update, remove, duplicate } = useTaskActions();
  const [tab, setTab] = useState<"details" | "history">("details");
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = q.data?.task;
  // Re-sync the form whenever the server copy changes (after save, or an inline edit in the grid).
  useEffect(() => {
    if (task) setF(toForm(task));
  }, [task]);
  useEffect(() => {
    setTab("details");
    setError(null);
  }, [taskId]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => (p ? { ...p, [k]: e.target.value } : p));

  let patch: TaskPatch | null = null;
  let patchError: string | null = null;
  if (task && f) {
    try {
      patch = diff(task, f);
    } catch (e) {
      patchError = (e as Error).message;
    }
  }
  const dirty = patch !== null && Object.keys(patch).length > 0;

  async function save() {
    if (!task || !f) return;
    setError(null);
    try {
      const p = diff(task, f);
      if (Object.keys(p).length === 0) return;
      await update.mutateAsync({ id: task.id, patch: p });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Modal
        open={taskId !== null}
        onOpenChange={(o) => !o && onClose()}
        side="right"
        title={task ? `${task.code} · ${task.title}` : "Task"}
        description={task ? `Created ${dateTimeOf(task.createdAt)} · updated ${dateTimeOf(task.updatedAt)}` : undefined}
        footer={
          task && (
            <>
              <Button variant="ghost" className="mr-auto text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
              <Button variant="outline" loading={duplicate.isPending} onClick={() => duplicate.mutate(task.id)}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button loading={update.isPending} disabled={!dirty || !!patchError} onClick={save}>
                Save changes
              </Button>
            </>
          )
        }
      >
        {q.isLoading && <PageLoader />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {task && f && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Tabs value={tab} onChange={setTab} tabs={[{ value: "details", label: "Details" }, { value: "history", label: "History", count: q.data?.activity.length }]} />
              <div className="flex items-center gap-2">
                <StatusBadge status={task.status} />
                {task.isOverdue && <Badge tone="red">Overdue</Badge>}
              </div>
            </div>

            {tab === "details" && (
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <Field label="Title" className="col-span-2">
                  <Input value={f.title} onChange={set("title")} maxLength={200} />
                </Field>
                <Field label="Description" className="col-span-2">
                  <Textarea value={f.description} onChange={set("description")} rows={3} />
                </Field>
                <Field label="Category">
                  <Select value={f.category} onChange={set("category")}>
                    {TASK_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={f.status} onChange={set("status")}>
                    {TASK_STATUSES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={f.priority} onChange={set("priority")}>
                    {TASK_PRIORITIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Progress %">
                  <Input type="number" min={0} max={100} value={f.progress} onChange={set("progress")} />
                </Field>
                <Field label="Assigned date">
                  <Input type="date" value={f.assignedDate} onChange={set("assignedDate")} />
                </Field>
                <Field label="Deadline (Asia/Dhaka)">
                  <Input type="datetime-local" value={f.deadline} onChange={set("deadline")} />
                </Field>
                <Field label="Start time (Asia/Dhaka)">
                  <Input type="datetime-local" value={f.startTime} onChange={set("startTime")} />
                </Field>
                <Field label="Completion time (Asia/Dhaka)">
                  <Input type="datetime-local" value={f.completedAt} onChange={set("completedAt")} />
                </Field>
                <Field label="Estimated duration" hint='e.g. "90", "1h 30m"'>
                  <Input value={f.estimate} onChange={set("estimate")} placeholder="—" />
                </Field>
                <Field label="Actual duration">
                  <Input value={f.actual} onChange={set("actual")} placeholder="—" />
                </Field>
                <Field label="Reference link" className="col-span-2">
                  <Input type="url" value={f.referenceUrl} onChange={set("referenceUrl")} placeholder="https://…" />
                </Field>
                <Field label="Implementation notes" className="col-span-2">
                  <Textarea value={f.implementationNotes} onChange={set("implementationNotes")} rows={4} />
                </Field>
                <Field label="Blockers / issues" className="col-span-2">
                  <Textarea value={f.blockers} onChange={set("blockers")} rows={3} />
                </Field>
                {(error || patchError) && <p className="col-span-2 text-xs text-destructive">{error ?? patchError}</p>}
                <button type="submit" className="hidden" />
              </form>
            )}

            {tab === "history" && (
              <ol className="space-y-2">
                {q.data!.activity.length === 0 && <li className="text-xs text-muted-foreground">No history yet.</li>}
                {q.data!.activity.map((a) => (
                  <li key={a.id} className="rounded-md border px-3 py-2 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{describe(a.action, a.field)}</span>
                      <span className="text-[11px] text-muted-foreground">{dateTimeOf(a.createdAt)}</span>
                    </div>
                    {a.field && (
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">
                        <span className="line-through">{shorten(a.oldValue)}</span> → <span className="text-foreground">{shorten(a.newValue)}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="It disappears from your task list and from future reports. Past submitted reports keep their own snapshot."
        confirmLabel="Delete task"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (!task) return;
          await remove.mutateAsync(task.id);
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
}

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  category: "Category",
  assigned_date: "Assigned date",
  start_time: "Start time",
  deadline: "Deadline",
  priority: "Priority",
  status: "Status",
  estimated_minutes: "Estimated minutes",
  actual_minutes: "Actual minutes",
  progress_percent: "Progress %",
  implementation_notes: "Implementation notes",
  blockers: "Blockers",
  completed_at: "Completion time",
  reference_url: "Reference link",
};
function describe(action: string, field: string | null) {
  if (action === "created") return "Task created";
  if (action === "duplicated") return "Created by duplicating a task";
  if (action === "deleted") return "Task deleted";
  if (action === "status_changed") return "Status changed";
  return field ? `${FIELD_LABEL[field] ?? field} changed` : action;
}
const shorten = (v: string | null) => (v == null || v === "" ? "—" : v.length > 80 ? `${v.slice(0, 80)}…` : v);
