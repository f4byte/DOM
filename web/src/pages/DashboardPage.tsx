import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDashed, FileText, ListChecks, LogIn, LogOut, Timer } from "lucide-react";
import { formatDuration, to12h } from "@shared/time";
import type { DashboardDTO } from "@shared/types";
import { AttendanceBadge, PriorityBadge, ReportStatusBadge, SourceBadge } from "@/components/badges";
import { Button, Card, CardBody, CardHeader, ErrorState, PageHeader, PageLoader, Progress, Skeleton, StatCard } from "@/components/ui";
import { useAttendanceActions } from "@/hooks/use-attendance";
import { api } from "@/lib/api";
import { dateLong, dateTimeOf, timeOf } from "@/lib/format";

const Charts = lazy(() => import("@/components/DashboardCharts").then((m) => ({ default: m.DashboardCharts })));

export function DashboardPage() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardDTO>("/dashboard"), refetchInterval: 60_000 });
  const { clockIn, clockOut } = useAttendanceActions();

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const a = d.attendance;
  const started = !!a.firstLoginAt;
  const t = d.tasks;

  return (
    <div>
      <PageHeader title="Dashboard" description={dateLong(d.date)} />

      {d.pendingEventCount > 0 && (
        <Link to="/attendance" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[13px] hover:bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span>
            <b>{d.pendingEventCount}</b> phone event{d.pendingEventCount > 1 ? "s are" : " is"} waiting for your confirmation — review in Attendance.
          </span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's attendance"
            description={`Office hours ${to12h(d.schedule.officeStart)} – ${to12h(d.schedule.officeEnd)}`}
            actions={<AttendanceBadge status={a.status} />}
          />
          <CardBody>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Mini label="Login" value={timeOf(a.firstLoginAt)} extra={<SourceBadge source={a.loginSource} />} />
              <Mini label="Logout" value={timeOf(a.lastLogoutAt)} extra={<SourceBadge source={a.logoutSource} />} />
              <Mini label="Worked" value={started ? formatDuration(a.workedMinutes) : "—"} />
              <Mini label={a.overtimeMinutes > 0 ? "Overtime" : "Remaining"} value={!started ? "—" : formatDuration(a.overtimeMinutes > 0 ? a.overtimeMinutes : a.remainingMinutes)} />
            </div>
            {started && <Progress className="mt-4" value={a.standardMinutes ? Math.min(100, Math.round((a.workedMinutes / a.standardMinutes) * 100)) : 0} />}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!started ? (
                <Button variant="success" loading={clockIn.isPending} onClick={() => clockIn.mutate()}>
                  <LogIn className="h-4 w-4" /> Clock in
                </Button>
              ) : (
                <Button variant="outline" loading={clockOut.isPending} onClick={() => clockOut.mutate()}>
                  <LogOut className="h-4 w-4" /> {a.lastLogoutAt ? "Update clock-out" : "Clock out"}
                </Button>
              )}
              {a.lateMinutes > 0 && <span className="text-xs text-amber-600 dark:text-amber-400">Arrived {formatDuration(a.lateMinutes)} late</span>}
              {a.earlyArrivalMinutes > 0 && <span className="text-xs text-muted-foreground">Arrived {formatDuration(a.earlyArrivalMinutes)} early</span>}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Today's report" />
          <CardBody>
            {d.report ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ReportStatusBadge status={d.report.status} />
                  {d.report.revision > 1 && <span className="text-xs text-muted-foreground">Revision {d.report.revision}</span>}
                </div>
                <Link to="/reports">
                  <Button variant="outline" size="sm">
                    <FileText className="h-3.5 w-3.5" /> {d.report.status === "draft" ? "Continue editing" : "Open report"}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground">No report yet for today.</p>
                <Link to="/reports">
                  <Button size="sm">
                    <FileText className="h-3.5 w-3.5" /> Generate report
                  </Button>
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total tasks" value={t.total} icon={<ListChecks className="h-4 w-4" />} />
        <StatCard label="Completed" value={t.completed} sub={`${t.completionPercent}% done`} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <StatCard label="In progress" value={t.inProgress} icon={<Timer className="h-4 w-4" />} tone="blue" />
        <StatCard label="Pending" value={t.pending} icon={<CircleDashed className="h-4 w-4" />} />
        <StatCard label="Overdue" value={t.overdue} icon={<AlertTriangle className="h-4 w-4" />} tone={t.overdue ? "red" : undefined} />
        <StatCard label="Assigned today" value={t.assignedToday} />
      </div>

      <Suspense
        fallback={
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        }
      >
        <Charts data={d} />
      </Suspense>

      <Card className="mt-4">
        <CardHeader title="Upcoming deadlines" description="Open tasks with a deadline, soonest first" actions={<Link to="/tasks" className="text-xs text-primary hover:underline">All tasks</Link>} />
        {d.upcoming.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-muted-foreground">No open tasks with deadlines.</p>
          </CardBody>
        ) : (
          <div className="divide-y">
            {d.upcoming.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-mono text-xs text-muted-foreground">{u.code}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{u.title}</span>
                <PriorityBadge priority={u.priority} />
                <span className={u.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>{u.isOverdue ? "Overdue · " : ""}{dateTimeOf(u.deadline)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Mini({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tnum mt-1 flex items-center gap-2 text-xl font-semibold">
        {value} {extra}
      </p>
    </div>
  );
}
