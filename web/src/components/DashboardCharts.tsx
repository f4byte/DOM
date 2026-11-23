import type { DashboardDTO } from "@shared/types";
import { CompletedLineChart, Donut, HBars, STATUS_COLOR, WorkedHoursChart } from "@/components/charts";
import { Card, CardBody, CardHeader } from "@/components/ui";

/** The three dashboard charts, loaded on demand (Recharts is the heaviest dependency). */
export function DashboardCharts({ data }: { data: DashboardDTO }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader title="Hours worked" description="Last 7 days" />
        <CardBody>
          <WorkedHoursChart data={data.trend} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tasks by status" />
        <CardBody>
          <Donut data={data.byStatus.map((s) => ({ name: s.status, value: s.count }))} colors={STATUS_COLOR} emptyText="No tasks yet" />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tasks by category" />
        <CardBody>
          <HBars data={data.byCategory.map((c) => ({ name: c.category, value: c.count }))} height={220} />
        </CardBody>
      </Card>
    </div>
  );
}
