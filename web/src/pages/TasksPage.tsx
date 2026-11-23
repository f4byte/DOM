import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, ExternalLink, ListChecks, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "@shared/constants";
import { formatDuration, localDate, localDateTimeToUtcIso, utcIsoToLocalDateTime } from "@shared/time";
import type { TaskDTO } from "@shared/types";
import { PRIORITY_TONE, STATUS_TONE, toneSelectClass } from "@/components/badges";
import { TaskDrawer } from "@/components/TaskDrawer";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, PageLoader, Select } from "@/components/ui";
import { useTaskActions, useTasks, type TaskFilters, type TaskPatch } from "@/hooks/use-tasks";
import { dateShort, timeOf } from "@/lib/format";
import { cn, downloadBlob, parseDuration } from "@/lib/utils";

/* ---------- inline editors (commit on blur / Enter / change; Esc reverts) ---------- */

function TextCell({ value, onCommit, className, placeholder }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <input
      key={value}
      className={cn("cell-input", className)}
      defaultValue={value}
      placeholder={placeholder}
      maxLength={200}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = value;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function DurationCell({ minutes, onCommit, label }: { minutes: number | null; onCommit: (v: number | null) => void; label: string }) {
  const shown = minutes == null ? "" : formatDuration(minutes);
  return (
    <input
      key={shown}
      className="cell-input tnum w-20"
      defaultValue={shown}
      placeholder="—"
      aria-label={label}
      onBlur={(e) => {
        const raw = e.target.value;
        if (raw === shown) return;
        const v = parseDuration(raw);
        if (Number.isNaN(v)) {
          toast.error(`${label}: use e.g. "90", "1h 30m" or "2h"`);
          e.target.value = shown;
          return;
        }
        onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function DateTimeCell({ iso, onCommit, label }: { iso: string | null; onCommit: (v: string | null) => void; label: string }) {
  const shown = iso ? utcIsoToLocalDateTime(iso) : "";
  return (
    <input
      key={shown}
      type="datetime-local"
      aria-label={label}
      className="cell-input tnum w-[170px]"
      defaultValue={shown}
      onBlur={(e) => e.target.value !== shown && onCommit(e.target.value ? localDateTimeToUtcIso(e.target.value) : null)}
    />
  );
}

/* ---------- header with sort toggle ---------- */

function Th({ label, col, sort, dir, onSort, className }: { label: string; col?: string; sort?: string; dir?: "asc" | "desc"; onSort?: (c: string) => void; className?: string }) {
  const active = col && sort === col;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("whitespace-nowrap border-b bg-muted/60 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      {col && onSort ? (
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(col)}>
          {label}
          <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
        </button>
      ) : (
        label
      )}
    </th>
  );
}

/* ---------- page ---------- */

export function TasksPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Omit<TaskFilters, "q" | "sort" | "dir">>({});
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<TaskDTO | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const { create, update, remove, duplicate } = useTaskActions();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query: TaskFilters = useMemo(() => ({ ...filters, q: debounced || undefined, sort: sort?.col, dir: sort?.dir }), [filters, debounced, sort]);
  const { data, isLoading, isError, error, refetch, isFetching } = useTasks(query);
  const rows = data?.tasks ?? [];

  const setF = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => setFilters((p) => ({ ...p, [k]: v || undefined }));
  const hasFilters = !!debounced || Object.values(filters).some(Boolean);
  const clear = () => {
    setSearch("");
    setFilters({});
  };
  const onSort = (col: string) => setSort((p) => (p?.col !== col ? { col, dir: "asc" } : p.dir === "asc" ? { col, dir: "desc" } : null));

  const patch = (t: TaskDTO, p: TaskPatch) => update.mutate({ id: t.id, patch: p });

  async function addRow() {
    const title = newTitle.trim();
    if (!title) return;
    await create.mutateAsync({ title, assignedDate: localDate(new Date()) });
    setNewTitle("");
  }

  async function exportCsv() {
    try {
      const res = await fetch("/api/export/tasks.csv", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      downloadBlob(await res.blob(), `pims-tasks-${localDate(new Date())}.csv`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const done = rows.filter((t) => t.status === "Completed").length;
  const overdue = rows.filter((t) => t.isOverdue).length;

  return (
    <div>
      <PageHeader
        title="My Tasks"
        description="Click any cell to edit it — changes save automatically. Open a row for notes, blockers and its history."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search title, notes, code…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
          </div>
          <Select className="w-auto" value={filters.status ?? ""} onChange={(e) => setF("status", e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.priority ?? ""} onChange={(e) => setF("priority", e.target.value)} aria-label="Filter by priority">
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select className="w-auto max-w-[190px]" value={filters.category ?? ""} onChange={(e) => setF("category", e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {TASK_CATEGORIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From
            <Input type="date" className="w-auto" value={filters.from ?? ""} onChange={(e) => setF("from", e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To
            <Input type="date" className="w-auto" value={filters.to ?? ""} onChange={(e) => setF("to", e.target.value)} />
          </label>
          <label className="flex h-9 items-center gap-1.5 text-[13px]">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!filters.overdue} onChange={(e) => setF("overdue", e.target.checked)} />
            Overdue only
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <span>
            {rows.length} task{rows.length === 1 ? "" : "s"} · {done} completed{overdue > 0 && <span className="font-medium text-red-600 dark:text-red-400"> · {overdue} overdue</span>}
          </span>
          {isFetching && <span>Updating…</span>}
        </div>

        {isLoading ? (
          <PageLoader />
        ) : isError ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1560px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th label="ID" col="code" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Task" col="title" sort={sort?.col} dir={sort?.dir} onSort={onSort} className="min-w-[260px]" />
                  <Th label="Category" col="category" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Assigned" col="assignedDate" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Started" col="startTime" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Deadline" col="deadline" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Priority" col="priority" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Status" col="status" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Est." col="estimatedMinutes" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Actual" col="actualMinutes" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Progress" col="progressPercent" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="Completed" col="completedAt" sort={sort?.col} dir={sort?.dir} onSort={onSort} />
                  <Th label="" className="w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {/* spreadsheet-style entry row */}
                <tr className="border-b bg-primary/[0.03]">
                  <td className="px-2 text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </td>
                  <td className="px-1 py-1" colSpan={11}>
                    <input
                      className="cell-input"
                      placeholder="Add a task — type a title and press Enter (use Quick add or press N for more fields)"
                      value={newTitle}
                      maxLength={200}
                      disabled={create.isPending}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addRow()}
                      aria-label="New task title"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button size="sm" variant="outline" disabled={!newTitle.trim()} loading={create.isPending} onClick={() => void addRow()}>
                      Add
                    </Button>
                  </td>
                </tr>

                {rows.map((t) => (
                  <tr key={t.id} className={cn("border-b last:border-b-0 hover:bg-accent/40", t.isOverdue && "bg-red-500/[0.06] hover:bg-red-500/10")}>
                    <td className="whitespace-nowrap px-2 font-mono text-xs text-muted-foreground">{t.code}</td>
                    <td className="px-1 py-1">
                      <TextCell value={t.title} onCommit={(v) => (v.trim() ? patch(t, { title: v.trim() }) : toast.error("Title can't be empty"))} className="font-medium" />
                    </td>
                    <td className="px-1">
                      <select className="cell-input w-[170px] cursor-pointer" value={t.category} onChange={(e) => patch(t, { category: e.target.value })} aria-label={`Category for ${t.code}`}>
                        {TASK_CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1">
                      <input
                        type="date"
                        className="cell-input tnum w-[136px]"
                        defaultValue={t.assignedDate}
                        key={t.assignedDate}
                        aria-label={`Assigned date for ${t.code}`}
                        onBlur={(e) => e.target.value && e.target.value !== t.assignedDate && patch(t, { assignedDate: e.target.value })}
                      />
                    </td>
                    <td className="tnum whitespace-nowrap px-2 text-xs text-muted-foreground" title={t.startTime ?? ""}>
                      {t.startTime ? `${dateShort(utcIsoToLocalDateTime(t.startTime).slice(0, 10))}, ${timeOf(t.startTime)}` : "—"}
                    </td>
                    <td className="px-1">
                      <DateTimeCell iso={t.deadline} label={`Deadline for ${t.code}`} onCommit={(v) => patch(t, { deadline: v })} />
                    </td>
                    <td className="px-1">
                      <select className={cn(toneSelectClass(PRIORITY_TONE[t.priority]), "w-[92px]")} value={t.priority} onChange={(e) => patch(t, { priority: e.target.value as TaskDTO["priority"] })} aria-label={`Priority for ${t.code}`}>
                        {TASK_PRIORITIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1">
                      <select className={cn(toneSelectClass(STATUS_TONE[t.status]), "w-[124px]")} value={t.status} onChange={(e) => patch(t, { status: e.target.value as TaskDTO["status"] })} aria-label={`Status for ${t.code}`}>
                        {TASK_STATUSES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1">
                      <DurationCell minutes={t.estimatedMinutes} label="Estimated duration" onCommit={(v) => patch(t, { estimatedMinutes: v })} />
                    </td>
                    <td className="px-1">
                      <DurationCell minutes={t.actualMinutes} label="Actual duration" onCommit={(v) => patch(t, { actualMinutes: v })} />
                    </td>
                    <td className="px-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          key={t.progressPercent}
                          type="number"
                          min={0}
                          max={100}
                          className="cell-input tnum w-14"
                          defaultValue={t.progressPercent}
                          aria-label={`Progress for ${t.code}`}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isInteger(n) || n < 0 || n > 100) {
                              toast.error("Progress must be a whole number from 0 to 100");
                              e.target.value = String(t.progressPercent);
                            } else if (n !== t.progressPercent) patch(t, { progressPercent: n });
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    </td>
                    <td className="tnum whitespace-nowrap px-2 text-xs text-muted-foreground">{t.completedAt ? `${dateShort(utcIsoToLocalDateTime(t.completedAt).slice(0, 10))}, ${timeOf(t.completedAt)}` : "—"}</td>
                    <td className="px-1">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" title="Open details & history" aria-label={`Open ${t.code}`} onClick={() => setOpenId(t.id)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Duplicate" aria-label={`Duplicate ${t.code}`} onClick={() => duplicate.mutate(t.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" aria-label={`Delete ${t.code}`} className="text-destructive hover:bg-destructive/10" onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <EmptyState
                icon={<ListChecks className="h-5 w-5" />}
                title={hasFilters ? "No tasks match these filters" : "No tasks yet"}
                description={hasFilters ? "Try clearing a filter or the search box." : "Type a title in the row above and press Enter to add your first task."}
                action={hasFilters ? <Button variant="outline" size="sm" onClick={clear}>Clear filters</Button> : undefined}
              />
            )}
          </div>
        )}
      </Card>

      <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.code ?? "task"}?`}
        description={
          <>
            "{deleting?.title}" will be removed from your list and future reports.
          </>
        }
        confirmLabel="Delete task"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          await remove.mutateAsync(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
