import { formatDuration, to12h, utcIsoToLocalTime } from "@shared/time";
import type { ReportDTO, ReportTaskItem } from "@shared/types";
import { ATTENDANCE_LABEL, ReportStatusBadge } from "@/components/badges";
import { Badge } from "@/components/ui";
import { dateLong } from "@/lib/format";
import { cn } from "@/lib/utils";

const TECH_LABEL = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  api: "API / Integration",
  testing: "Testing & Debugging",
  deployment: "Deployment",
  other: "Other",
} as const;

const clock = (iso: string | null) => (iso ? to12h(utcIsoToLocalTime(iso)) : "—");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">{title}</h3>
      {children}
    </section>
  );
}

function Items({ items, showReason }: { items: ReportTaskItem[]; showReason?: boolean }) {
  return (
    <ol className="space-y-2.5">
      {items.map((i, n) => (
        <li key={`${i.taskId ?? "x"}-${n}`} className="flex gap-3 text-[13px]">
          <span className="tnum w-5 shrink-0 text-muted-foreground">{n + 1}.</span>
          <div className="min-w-0">
            <p className="font-medium">
              {i.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i.code}</span>}
              {i.title}
              {i.progress != null && <Badge className="ml-2" tone="blue">{i.progress}%</Badge>}
              {!!i.timeSpentMinutes && <Badge className="ml-2">{formatDuration(i.timeSpentMinutes)}</Badge>}
            </p>
            {i.details.trim() && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{i.details}</p>}
            {showReason && i.reason?.trim() && (
              <p className="mt-0.5 text-muted-foreground">
                <span className="font-medium text-foreground">Reason:</span> {i.reason}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Read-only rendering of a report. Used for the preview, the locked view, the TL review page and the public share page. */
export function ReportView({ report, className }: { report: ReportDTO; className?: string }) {
  const c = report.content;
  const h = report.header;
  const a = h.attendance;
  const tech = (Object.keys(TECH_LABEL) as (keyof typeof TECH_LABEL)[]).filter((k) => c.technical[k].length);
  const empty = !c.summary.trim() && !c.completed.length && !c.inProgress.length && !c.pending.length && !tech.length && !c.challenges.length && !c.nextPlan.length;

  return (
    <article className={cn("rounded-xl border bg-card p-5 shadow-card sm:p-7", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Daily Progress Report</h2>
          <p className="text-[13px] text-muted-foreground">
            {dateLong(report.reportDate)}
            {report.revision > 1 && ` · Revision ${report.revision}`}
          </p>
        </div>
        <ReportStatusBadge status={report.status} />
      </header>

      <dl className="mt-4 grid gap-x-6 gap-y-1.5 rounded-lg bg-muted/50 p-3 text-[13px] sm:grid-cols-2">
        <Row k="Name" v={h.employeeName} />
        <Row k="Role" v={h.employmentType} />
        <Row k="Mentor / Team Lead" v={h.mentorName} />
        <Row k="Date" v={dateLong(report.reportDate)} />
        {a && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">Attendance: </dt>
            <dd className="inline text-muted-foreground">
              {ATTENDANCE_LABEL[a.status]} · In {clock(a.loginAt)} · Out {clock(a.logoutAt)} · Worked {formatDuration(a.workedMinutes)}
              {a.lateMinutes > 0 && ` · Late ${formatDuration(a.lateMinutes)}`}
              {a.earlyDepartureMinutes > 0 && ` · Left early ${formatDuration(a.earlyDepartureMinutes)}`}
              {a.overtimeMinutes > 0 && ` · Overtime ${formatDuration(a.overtimeMinutes)}`}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-6">
        {empty && <p className="text-[13px] text-muted-foreground">This report has no content yet.</p>}
        {c.summary.trim() && (
          <Section title="Summary">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{c.summary}</p>
          </Section>
        )}
        {c.completed.length > 0 && (
          <Section title={`Completed tasks (${c.completed.length})`}>
            <Items items={c.completed} />
          </Section>
        )}
        {c.inProgress.length > 0 && (
          <Section title={`In-progress tasks (${c.inProgress.length})`}>
            <Items items={c.inProgress} />
          </Section>
        )}
        {c.pending.length > 0 && (
          <Section title={`Pending tasks (${c.pending.length})`}>
            <Items items={c.pending} showReason />
          </Section>
        )}
        {tech.length > 0 && (
          <Section title="Technical work">
            <div className="space-y-3">
              {tech.map((k) => (
                <div key={k}>
                  <p className="text-[13px] font-medium">{TECH_LABEL[k]}</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
                    {c.technical[k].map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}
        {c.challenges.length > 0 && (
          <Section title="Challenges & solutions">
            <ol className="space-y-2.5">
              {c.challenges.map((x, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="tnum w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
                  <div>
                    <p>
                      <span className="font-medium">Problem:</span> {x.problem}
                    </p>
                    {x.solution.trim() && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Solution:</span> {x.solution}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}
        {c.nextPlan.length > 0 && (
          <Section title="Plan for next working day">
            <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
              {c.nextPlan.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="inline font-medium">{k}: </dt>
      <dd className="inline text-muted-foreground">{v}</dd>
    </div>
  );
}
