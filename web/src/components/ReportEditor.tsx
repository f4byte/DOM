import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDuration } from "@shared/time";
import type { ReportContent, ReportTaskItem } from "@shared/types";
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { parseDuration } from "@/lib/utils";

type Tech = ReportContent["technical"];
const TECH_FIELDS: { key: keyof Tech; label: string }[] = [
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "database", label: "Database" },
  { key: "api", label: "API / Integration" },
  { key: "testing", label: "Testing & Debugging" },
  { key: "deployment", label: "Deployment" },
  { key: "other", label: "Other" },
];

/** Tidy the editor state before saving: trim, drop empty rows and blank lines. */
export function cleanContent(c: ReportContent): ReportContent {
  const items = (xs: ReportTaskItem[]) => xs.map((i) => ({ ...i, title: i.title.trim(), details: i.details.trim(), reason: i.reason?.trim() })).filter((i) => i.title);
  const lines = (xs: string[]) => xs.map((l) => l.trim()).filter(Boolean);
  return {
    summary: c.summary.trim(),
    completed: items(c.completed),
    inProgress: items(c.inProgress),
    pending: items(c.pending),
    technical: Object.fromEntries(TECH_FIELDS.map(({ key }) => [key, lines(c.technical[key])])) as Tech,
    challenges: c.challenges.map((x) => ({ problem: x.problem.trim(), solution: x.solution.trim() })).filter((x) => x.problem),
    nextPlan: lines(c.nextPlan),
  };
}

function ItemsEditor({
  title,
  description,
  items,
  kind,
  onChange,
}: {
  title: string;
  description: string;
  items: ReportTaskItem[];
  kind: "done" | "wip" | "pending";
  onChange: (xs: ReportTaskItem[]) => void;
}) {
  const set = (n: number, p: Partial<ReportTaskItem>) => onChange(items.map((x, i) => (i === n ? { ...x, ...p } : x)));
  return (
    <Card>
      <CardHeader
        title={`${title} (${items.length})`}
        description={description}
        actions={
          <Button size="sm" variant="outline" onClick={() => onChange([...items, { title: "", details: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
        {items.map((it, n) => (
          <div key={n} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              {it.code && <span className="font-mono text-xs text-muted-foreground">{it.code}</span>}
              <Input value={it.title} onChange={(e) => set(n, { title: e.target.value })} placeholder="Task title" maxLength={300} aria-label="Task title" />
              <Button variant="ghost" size="icon" aria-label="Remove item" className="text-destructive hover:bg-destructive/10" onClick={() => onChange(items.filter((_, i) => i !== n))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea className="mt-2" rows={2} value={it.details} onChange={(e) => set(n, { details: e.target.value })} placeholder="What was done / current state" aria-label="Details" />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {kind === "done" && (
                <Field label="Time spent" hint='e.g. "1h 30m"'>
                  <DurationInput minutes={it.timeSpentMinutes ?? null} onChange={(v) => set(n, { timeSpentMinutes: v })} />
                </Field>
              )}
              {kind === "wip" && (
                <Field label="Progress %">
                  <Input type="number" min={0} max={100} value={it.progress ?? ""} onChange={(e) => set(n, { progress: e.target.value === "" ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value)))) })} />
                </Field>
              )}
              {kind === "pending" && (
                <Field label="Reason it is pending" className="sm:col-span-2">
                  <Input value={it.reason ?? ""} onChange={(e) => set(n, { reason: e.target.value })} maxLength={1000} />
                </Field>
              )}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function DurationInput({ minutes, onChange }: { minutes: number | null; onChange: (v: number | null) => void }) {
  const shown = minutes == null ? "" : formatDuration(minutes);
  return (
    <Input
      key={shown}
      defaultValue={shown}
      placeholder="—"
      onBlur={(e) => {
        const v = parseDuration(e.target.value);
        if (Number.isNaN(v)) {
          toast.error('Time spent: use e.g. "90", "1h 30m" or "2h"');
          e.target.value = shown;
        } else if (v !== minutes) onChange(v);
      }}
    />
  );
}

/** One bullet per line. Empty lines are kept while typing and removed on save (see cleanContent). */
function LinesField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <Field label={label} hint="One point per line">
      <Textarea rows={Math.max(2, Math.min(8, value.length + 1))} value={value.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder={placeholder} />
    </Field>
  );
}

/** Controlled editor for a draft report's content. */
export function ReportEditor({ content, onChange }: { content: ReportContent; onChange: (c: ReportContent) => void }) {
  const patch = (p: Partial<ReportContent>) => onChange({ ...content, ...p });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Summary" description="A short overview of the day for your Team Lead." />
        <CardBody>
          <Textarea rows={3} value={content.summary} onChange={(e) => patch({ summary: e.target.value })} maxLength={3000} aria-label="Summary" />
        </CardBody>
      </Card>

      <ItemsEditor title="Completed tasks" description="Finished today." items={content.completed} kind="done" onChange={(completed) => patch({ completed })} />
      <ItemsEditor title="In-progress tasks" description="Started but not finished." items={content.inProgress} kind="wip" onChange={(inProgress) => patch({ inProgress })} />
      <ItemsEditor title="Pending tasks" description="Not started or waiting — say why." items={content.pending} kind="pending" onChange={(pending) => patch({ pending })} />

      <Card>
        <CardHeader title="Technical work" description="What you implemented, by area." />
        <CardBody className="grid gap-3 md:grid-cols-2">
          {TECH_FIELDS.map(({ key, label }) => (
            <LinesField key={key} label={label} value={content.technical[key]} onChange={(v) => patch({ technical: { ...content.technical, [key]: v } })} />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Challenges & solutions (${content.challenges.length})`}
          actions={
            <Button size="sm" variant="outline" onClick={() => patch({ challenges: [...content.challenges, { problem: "", solution: "" }] })}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {content.challenges.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
          {content.challenges.map((x, n) => (
            <div key={n} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_auto]">
              <Field label="Problem">
                <Textarea rows={2} value={x.problem} onChange={(e) => patch({ challenges: content.challenges.map((y, i) => (i === n ? { ...y, problem: e.target.value } : y)) })} />
              </Field>
              <Field label="Solution">
                <Textarea rows={2} value={x.solution} onChange={(e) => patch({ challenges: content.challenges.map((y, i) => (i === n ? { ...y, solution: e.target.value } : y)) })} />
              </Field>
              <Button variant="ghost" size="icon" aria-label="Remove" className="mt-5 text-destructive hover:bg-destructive/10" onClick={() => patch({ challenges: content.challenges.filter((_, i) => i !== n) })}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Plan for next working day" />
        <CardBody>
          <LinesField label="Next steps" value={content.nextPlan} onChange={(nextPlan) => patch({ nextPlan })} />
        </CardBody>
      </Card>
    </div>
  );
}
