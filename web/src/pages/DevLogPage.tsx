import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Code2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DEV_AREAS, TASK_STATUSES } from "@shared/constants";
import { addDays, localDate } from "@shared/time";
import type { DevLogDTO } from "@shared/types";
import { StatusBadge } from "@/components/badges";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea } from "@/components/ui";
import { useTasks } from "@/hooks/use-tasks";
import { api, errorMessage } from "@/lib/api";
import { dateLong } from "@/lib/format";

interface Summary {
  date: string;
  totalEntries: number;
  byArea: { area: string; count: number; completed: number }[];
  technologies: string[];
  problems: { area: string; problem: string; solution: string }[];
  nextSteps: string[];
}

interface Form {
  area: string;
  taskId: string;
  implemented: string;
  technologies: string;
  problems: string;
  solutions: string;
  status: string;
  nextPlan: string;
}
const blank = (): Form => ({ area: DEV_AREAS[0], taskId: "", implemented: "", technologies: "", problems: "", solutions: "", status: "In Progress", nextPlan: "" });

export function DevLogPage() {
  const today = localDate(new Date());
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<DevLogDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<DevLogDTO | null>(null);
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["devlogs", "report"]) void qc.invalidateQueries({ queryKey: [k] });
  };

  const logs = useQuery({ queryKey: ["devlogs", "list", date], queryFn: () => api.get<{ logs: DevLogDTO[] }>(`/devlogs?date=${date}`) });
  const summary = useQuery({ queryKey: ["devlogs", "summary", date], queryFn: () => api.get<Summary>(`/devlogs/summary?date=${date}`) });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/devlogs/${id}`),
    onSuccess: () => {
      toast.success("Entry deleted");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const entries = logs.data?.logs ?? [];
  const s = summary.data;

  return (
    <div>
      <PageHeader
        title="Development Log"
        description="Record what you built, with which tools, what went wrong and what's next. These entries feed your daily report."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> New entry
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="date" className="w-auto" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Log date" />
          <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-[13px] text-muted-foreground">{dateLong(date)}</span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {logs.isLoading ? (
            <PageLoader />
          ) : logs.isError ? (
            <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
          ) : entries.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Code2 className="h-5 w-5" />}
                title="No entries for this day"
                description="Add what you implemented in frontend, backend, database, API, testing or deployment."
                action={
                  <Button onClick={() => setEditing("new")}>
                    <Plus className="h-4 w-4" /> New entry
                  </Button>
                }
              />
            </Card>
          ) : (
            entries.map((l) => (
              <Card key={l.id}>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="blue">{l.area}</Badge>
                    <StatusBadge status={l.status} />
                    {l.taskCode && (
                      <span className="text-xs text-muted-foreground">
                        {l.taskCode} · {l.taskTitle}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" aria-label="Edit entry" onClick={() => setEditing(l)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete entry" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleting(l)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <CardBody className="space-y-2.5 text-[13px]">
                  <Block label="Implemented" text={l.implemented} />
                  {l.technologies && (
                    <div className="flex flex-wrap gap-1.5">
                      {l.technologies.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  )}
                  <Block label="Problems" text={l.problems} />
                  <Block label="Solutions" text={l.solutions} />
                  <Block label="Next plan" text={l.nextPlan} />
                </CardBody>
              </Card>
            ))
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Daily summary" description={s ? `${s.totalEntries} entr${s.totalEntries === 1 ? "y" : "ies"}` : undefined} />
          <CardBody className="space-y-4 text-[13px]">
            {summary.isLoading && <PageLoader />}
            {s && s.totalEntries === 0 && <p className="text-xs text-muted-foreground">Nothing logged yet.</p>}
            {s && s.byArea.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">By area</p>
                <ul className="space-y-1">
                  {s.byArea.map((a) => (
                    <li key={a.area} className="flex justify-between">
                      <span>{a.area}</span>
                      <span className="tnum text-muted-foreground">
                        {a.count} · {a.completed} done
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s && s.technologies.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Technologies</p>
                <div className="flex flex-wrap gap-1.5">
                  {s.technologies.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </div>
            )}
            {s && s.problems.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Problems & fixes</p>
                <ul className="space-y-1.5">
                  {s.problems.map((p, i) => (
                    <li key={i}>
                      {p.problem}
                      {p.solution && <span className="block text-xs text-muted-foreground">→ {p.solution}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s && s.nextSteps.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Next steps</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {s.nextSteps.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <EntryDialog
        key={editing === "new" ? `new-${date}` : editing ? editing.id : "closed"}
        entry={editing}
        date={date}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this entry?"
        description="It will no longer appear in your daily summary or reports."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id).catch(() => undefined);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function EntryDialog({ entry, date, onClose, onSaved }: { entry: DevLogDTO | "new" | null; date: string; onClose: () => void; onSaved: () => void }) {
  const tasks = useTasks({ sort: "code", dir: "desc" });
  const [f, setF] = useState<Form>(() =>
    entry && entry !== "new"
      ? { area: entry.area, taskId: entry.taskId ? String(entry.taskId) : "", implemented: entry.implemented, technologies: entry.technologies, problems: entry.problems, solutions: entry.solutions, status: entry.status, nextPlan: entry.nextPlan }
      : blank(),
  );
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = { logDate: entry && entry !== "new" ? entry.logDate : date, area: f.area, taskId: f.taskId ? Number(f.taskId) : null, implemented: f.implemented, technologies: f.technologies, problems: f.problems, solutions: f.solutions, status: f.status, nextPlan: f.nextPlan };
      return entry && entry !== "new" ? api.patch(`/devlogs/${entry.id}`, body) : api.post("/devlogs", body);
    },
    onSuccess: () => {
      toast.success(entry === "new" ? "Entry added" : "Entry updated");
      onSaved();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal
      open={entry !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={entry === "new" ? "New development entry" : "Edit development entry"}
      description={dateLong(entry && entry !== "new" ? entry.logDate : date)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!f.implemented.trim()} onClick={() => save.mutate()}>
            {entry === "new" ? "Add entry" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Area">
          <Select value={f.area} onChange={set("area")}>
            {DEV_AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {TASK_STATUSES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Related task (optional)" className="sm:col-span-2">
          <Select value={f.taskId} onChange={set("taskId")}>
            <option value="">— None —</option>
            {(tasks.data?.tasks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} · {t.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What was implemented" className="sm:col-span-2">
          <Textarea rows={3} value={f.implemented} onChange={set("implemented")} autoFocus />
        </Field>
        <Field label="Technologies used" hint="Comma-separated, e.g. React, Hono, D1" className="sm:col-span-2">
          <Input value={f.technologies} onChange={set("technologies")} />
        </Field>
        <Field label="Problems faced">
          <Textarea rows={3} value={f.problems} onChange={set("problems")} />
        </Field>
        <Field label="Solutions applied">
          <Textarea rows={3} value={f.solutions} onChange={set("solutions")} />
        </Field>
        <Field label="Next plan" hint="One step per line" className="sm:col-span-2">
          <Textarea rows={2} value={f.nextPlan} onChange={set("nextPlan")} />
        </Field>
        {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
