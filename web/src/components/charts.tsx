// Recharts wrappers shared by the Dashboard and Analytics pages. Imported lazily so charts don't weigh down the first load.
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const STATUS_COLOR: Record<string, string> = {
  "Not Started": "#94a3b8",
  "In Progress": "#3b82f6",
  "Under Review": "#8b5cf6",
  Completed: "#10b981",
  "On Hold": "#f59e0b",
  Blocked: "#ef4444",
};
export const PRIORITY_COLOR: Record<string, string> = { Low: "#94a3b8", Medium: "#3b82f6", High: "#f59e0b", Urgent: "#ef4444" };
const PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#14b8a6", "#ec4899", "#64748b", "#ef4444", "#84cc16", "#0ea5e9", "#a855f7"];

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const grid = "hsl(var(--border))";
const tooltipStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" };
const short = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Empty({ text }: { text: string }) {
  return <div className="grid h-full place-items-center text-xs text-muted-foreground">{text}</div>;
}

/** Hours worked (and overtime) per day. */
export function WorkedHoursChart({ data, height = 220 }: { data: { date: string; workedMinutes: number; overtimeMinutes: number }[]; height?: number }) {
  const rows = data.map((d) => ({ date: short(d.date), Worked: +(d.workedMinutes / 60).toFixed(2), Overtime: +(d.overtimeMinutes / 60).toFixed(2) }));
  if (!rows.some((r) => r.Worked > 0)) return <div style={{ height }}><Empty text="No attendance recorded in this period" /></div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={axis} tickLine={false} axisLine={false} unit="h" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} formatter={(v: number) => `${v}h`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="Worked" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
        <Bar isAnimationActive={false} dataKey="Overtime" stackId="a" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Tasks completed per day. */
export function CompletedLineChart({ data, height = 220 }: { data: { date: string; count: number }[]; height?: number }) {
  const rows = data.map((d) => ({ date: short(d.date), Completed: d.count }));
  if (!rows.some((r) => r.Completed > 0)) return <div style={{ height }}><Empty text="No tasks completed in this period" /></div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line isAnimationActive={false} type="monotone" dataKey="Completed" stroke="#10b981" strokeWidth={2} dot={{ r: 2.5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Donut with a legend underneath. `colors` maps a label to a colour; unknown labels use the palette. */
export function Donut({ data, colors, height = 220, emptyText = "No data yet" }: { data: { name: string; value: number }[]; colors?: Record<string, string>; height?: number; emptyText?: string }) {
  const rows = data.filter((d) => d.value > 0);
  if (rows.length === 0) return <div style={{ height }}><Empty text={emptyText} /></div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={2} stroke="none">
          {rows.map((r, i) => (
            <Cell key={r.name} fill={colors?.[r.name] ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars, e.g. tasks per category. */
export function HBars({ data, height, color = "#3b82f6", unit = "" }: { data: { name: string; value: number }[]; height?: number; color?: string; unit?: string }) {
  const h = height ?? Math.max(120, data.length * 34 + 20);
  if (data.length === 0) return <div style={{ height: 140 }}><Empty text="No data yet" /></div>;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} unit={unit} />
        <YAxis type="category" dataKey="name" width={140} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} />
        <Bar isAnimationActive={false} dataKey="value" fill={color} radius={[0, 3, 3, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}
