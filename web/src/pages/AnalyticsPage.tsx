import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, formatDuration, localDate } from "@shared/time";
import type { AnalyticsDTO } from "@shared/types";
import { CompletedLineChart, Donut, HBars, PRIORITY_COLOR, STATUS_COLOR, WorkedHoursChart } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, ErrorState, Input, PageHeader, PageLoader, StatCard } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { hoursText } from "@/lib/format";

const PRESETS = [
  { label: "7 days", days: 6 },
  { label: "30 days", days: 29 },
  { label: "90 days", days: 89 },
];

export function AnalyticsPage() {
  const today = localDate(new Date());
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const q = useQuery({ queryKey: ["analytics", range], queryFn: () => api.get<AnalyticsDTO>(`/analytics${qs(range)}`) });
  const d = q.data;
  const valid = range.from <= range.to;

  return (
    <div>
      <PageHeader title="Analytics" description="Trends across attendance, tasks and reports for the period you choose." />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button key={p.label} variant={range.from === addDays(today, -p.days) && range.to === today ? "default" : "outline"} size="sm" onClick={() => setRange({ from: addDays(today, -p.days), to: today })}>
              Last {p.label}
            </Button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            From <Input type="date" className="w-auto" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To <Input type="date" className="w-auto" value={range.to} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
          {!valid && <span className="text-xs text-destructive">“From” must not be after “To”.</span>}
        </div>
      </Card>

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Days attended" value={d.attendance.daysAttended} sub={`${d.attendance.onTimeDays} on time · ${d.attendance.lateDays} late`} />
            <StatCard label="Total worked" value={hoursText(d.attendance.totalWorkedMinutes)} sub={`avg ${hoursText(d.attendance.averageWorkedMinutes)} / day`} />
            <StatCard label="Overtime" value={formatDuration(d.attendance.totalOvertimeMinutes)} tone="blue" />
            <StatCard label="Tasks completed" value={`${d.tasks.completed}/${d.tasks.total}`} sub={`${d.tasks.completedOnTime} on time · ${d.tasks.completedLate} late`} tone="green" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Hours worked per day" />
              <CardBody>
                <WorkedHoursChart data={d.attendance.days} height={260} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Tasks completed per day" />
              <CardBody>
                <CompletedLineChart data={d.tasks.completedPerDay} height={260} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Tasks by status" />
              <CardBody>
                <Donut data={d.tasks.byStatus.map((s) => ({ name: s.status, value: s.count }))} colors={STATUS_COLOR} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Tasks by priority" />
              <CardBody>
                <Donut data={d.tasks.byPriority.map((s) => ({ name: s.priority, value: s.count }))} colors={PRIORITY_COLOR} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Tasks by category" />
              <CardBody>
                <HBars data={d.tasks.byCategory.map((c) => ({ name: c.category, value: c.total }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Time logged by category" description="Sum of actual durations on tasks in this period" />
              <CardBody>
                <HBars color="#8b5cf6" unit="h" data={d.tasks.byCategory.filter((c) => c.actualMinutes > 0).map((c) => ({ name: c.category, value: +(c.actualMinutes / 60).toFixed(1) }))} />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Attendance punctuality" />
            <CardBody className="grid gap-4 text-[13px] sm:grid-cols-3">
              <Stat label="Total late time" value={formatDuration(d.attendance.totalLateMinutes)} />
              <Stat label="Total early-departure time" value={formatDuration(d.attendance.totalEarlyDepartureMinutes)} />
              <Stat label="Reports" value={d.reports.byStatus.map((s) => `${s.count} ${s.status.replace("_", " ")}`).join(" · ") || "None in this period"} />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
