// Builds a daily report from real task / dev-log / attendance records. Nothing here is invented data.
import type { UserSettings } from "../../../shared/constants";
import { formatDuration, localDate, nextWorkingDay } from "../../../shared/time";
import type { AttendanceDTO, ReportContent, ReportHeader, ReportTaskItem } from "../../../shared/types";
import { inDayScope, type TaskRow } from "./tasks";

export interface DevLogRow {
  id: number;
  log_date: string;
  area: string;
  task_id: number | null;
  implemented: string;
  technologies: string;
  problems: string;
  solutions: string;
  status: string;
  next_plan: string;
}

type Bucket = keyof ReportContent["technical"];

const BUCKET_BY_CATEGORY: Record<string, Bucket> = {
  "Frontend Development": "frontend",
  "Backend Development": "backend",
  "Database Management": "database",
  "API Integration": "api",
  "Testing & Debugging": "testing",
  "Bug Fixing": "testing",
  Deployment: "deployment",
  "Full-stack Development": "other",
  "Research & Learning": "other",
  Documentation: "other",
  Other: "other",
};

const BUCKET_BY_AREA: Record<string, Bucket> = {
  "Frontend Implementation": "frontend",
  "Backend Implementation": "backend",
  "Database Implementation": "database",
  "API Development": "api",
  Integration: "api",
  Testing: "testing",
  Deployment: "deployment",
};

export interface BuildInput {
  date: string;
  profile: { fullName: string; mentorName: string; employmentType: string };
  settings: UserSettings;
  tasks: TaskRow[];
  devLogs: DevLogRow[];
  attendance: AttendanceDTO | null;
}

export function buildHeader(i: Pick<BuildInput, "date" | "profile" | "attendance">): ReportHeader {
  const a = i.attendance;
  return {
    employeeName: i.profile.fullName,
    mentorName: i.profile.mentorName,
    employmentType: i.profile.employmentType,
    date: i.date,
    generatedAt: new Date().toISOString(),
    attendance:
      a && a.firstLoginAt
        ? {
            status: a.status,
            loginAt: a.firstLoginAt,
            logoutAt: a.lastLogoutAt,
            workedMinutes: a.workedMinutes,
            lateMinutes: a.lateMinutes,
            earlyArrivalMinutes: a.earlyArrivalMinutes,
            earlyDepartureMinutes: a.earlyDepartureMinutes,
            overtimeMinutes: a.overtimeMinutes,
          }
        : null,
  };
}

const item = (t: TaskRow, extra: Partial<ReportTaskItem> = {}): ReportTaskItem => ({
  taskId: t.id,
  code: t.task_code,
  title: t.title,
  category: t.category,
  status: t.status,
  details: (t.implementation_notes || t.description || "").trim(),
  progress: t.progress_percent,
  timeSpentMinutes: t.actual_minutes,
  ...extra,
});

function pendingReason(t: TaskRow, date: string): string {
  if (t.blockers.trim()) return t.blockers.trim();
  if (t.status === "Blocked") return "Blocked — waiting on a dependency or clarification.";
  if (t.status === "On Hold") return "On hold.";
  if (t.deadline && localDate(t.deadline) < date) return "Overdue — not yet started.";
  return "Not started yet.";
}

const pushUnique = (arr: string[], v: string) => {
  const s = v.trim();
  if (s && !arr.includes(s)) arr.push(s);
};

export function buildReport(i: BuildInput): { header: ReportHeader; content: ReportContent } {
  const { date, tasks, devLogs, settings } = i;
  const scope = tasks.filter((t) => inDayScope(t, date));

  const completed = scope.filter((t) => t.status === "Completed" && t.completed_at && localDate(t.completed_at) === date);
  const inProgress = scope.filter((t) => (t.status === "In Progress" || t.status === "Under Review") && t.assigned_date <= date);
  const pending = scope.filter(
    (t) => ["Not Started", "On Hold", "Blocked"].includes(t.status) && (t.assigned_date === date || (t.deadline && localDate(t.deadline) <= date)),
  );

  const technical: ReportContent["technical"] = { frontend: [], backend: [], database: [], api: [], testing: [], deployment: [], other: [] };
  const coveredByLog = new Set<number>();
  for (const l of devLogs) {
    if (l.task_id) coveredByLog.add(l.task_id);
    const bucket = BUCKET_BY_AREA[l.area] ?? "other";
    const body = l.implemented.trim();
    if (!body && !l.technologies.trim()) continue;
    pushUnique(technical[bucket], `${body || l.area}${l.technologies.trim() ? ` (Technologies: ${l.technologies.trim()})` : ""}`);
  }
  for (const t of [...completed, ...inProgress]) {
    if (coveredByLog.has(t.id)) continue;
    const bucket = BUCKET_BY_CATEGORY[t.category] ?? "other";
    const note = t.implementation_notes.trim();
    pushUnique(technical[bucket], `${t.title}${note ? ` — ${note}` : ` (${t.status}, ${t.progress_percent}%)`}`);
  }

  const challenges: ReportContent["challenges"] = [];
  for (const l of devLogs) {
    if (l.problems.trim()) challenges.push({ problem: l.problems.trim(), solution: l.solutions.trim() });
  }
  for (const t of scope) {
    if (t.blockers.trim() && !challenges.some((c) => c.problem.includes(t.blockers.trim()))) {
      challenges.push({ problem: `${t.title}: ${t.blockers.trim()}`, solution: "" });
    }
  }

  const nextDate = nextWorkingDay(date, settings.workingDays);
  const nextPlan: string[] = [];
  for (const l of devLogs) for (const line of l.next_plan.split("\n")) pushUnique(nextPlan, line);
  for (const t of tasks) {
    if (t.status !== "Completed" && t.assigned_date === nextDate) pushUnique(nextPlan, t.title);
  }
  for (const t of inProgress) pushUnique(nextPlan, `Continue: ${t.title} (${t.progress_percent}% done)`);
  for (const t of pending) pushUnique(nextPlan, `Start / unblock: ${t.title}`);

  const a = i.attendance;
  const worked = a && a.firstLoginAt ? ` Worked ${formatDuration(a.workedMinutes)}${a.lastLogoutAt ? "" : " so far"}.` : "";
  const summary = `Completed ${completed.length} task${completed.length === 1 ? "" : "s"}; ${inProgress.length} in progress; ${pending.length} pending.${worked}`;

  return {
    header: buildHeader(i),
    content: {
      summary,
      completed: completed.map((t) => item(t)),
      inProgress: inProgress.map((t) => item(t)),
      pending: pending.map((t) => item(t, { reason: pendingReason(t, date) })),
      technical,
      challenges,
      nextPlan,
    },
  };
}

export function isReportEmpty(c: ReportContent): boolean {
  const techCount = Object.values(c.technical).reduce((n, a) => n + a.length, 0);
  return !c.summary.trim() && !c.completed.length && !c.inProgress.length && !c.pending.length && !techCount && !c.challenges.length && !c.nextPlan.length;
}

/** Flatten task entries for the relational report_tasks index. */
export function reportTaskRows(c: ReportContent) {
  const rows: Array<{ taskId: number | null; section: "completed" | "in_progress" | "pending"; code: string | null; title: string; category: string | null; status: string | null }> = [];
  const add = (section: "completed" | "in_progress" | "pending", list: ReportTaskItem[]) =>
    list.forEach((t) => rows.push({ taskId: t.taskId ?? null, section, code: t.code ?? null, title: t.title, category: t.category ?? null, status: t.status ?? null }));
  add("completed", c.completed);
  add("in_progress", c.inProgress);
  add("pending", c.pending);
  return rows;
}
