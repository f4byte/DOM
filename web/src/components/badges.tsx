import { Bot, Hand } from "lucide-react";
import type { AttendanceStatus, ReportStatus, TaskPriority, TaskStatus } from "@shared/constants";
import { Badge, TONE_CLASSES, type Tone } from "@/components/ui";
import { cn } from "@/lib/utils";

export const STATUS_TONE: Record<TaskStatus, Tone> = {
  "Not Started": "gray",
  "In Progress": "blue",
  "Under Review": "purple",
  Completed: "green",
  "On Hold": "amber",
  Blocked: "red",
};
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { Low: "gray", Medium: "blue", High: "amber", Urgent: "red" };

export const ATTENDANCE_TONE: Record<AttendanceStatus, Tone> = {
  present: "green",
  overtime: "blue",
  late: "amber",
  early_leave: "amber",
  late_early_leave: "red",
  in_progress: "blue",
  missing_logout: "red",
  leave: "purple",
  holiday: "purple",
  absent: "red",
};
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  overtime: "Overtime",
  late: "Late",
  early_leave: "Early leave",
  late_early_leave: "Late + early leave",
  in_progress: "In progress",
  missing_logout: "Missing logout",
  leave: "Leave",
  holiday: "Holiday",
  absent: "Absent",
};

export const REPORT_TONE: Record<ReportStatus, Tone> = {
  draft: "gray",
  submitted: "blue",
  viewed: "purple",
  reviewed: "teal",
  revision_requested: "amber",
  approved: "green",
};
export const REPORT_LABEL: Record<ReportStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  viewed: "Viewed",
  reviewed: "Reviewed",
  revision_requested: "Revision requested",
  approved: "Approved",
};

export const StatusBadge = ({ status }: { status: TaskStatus }) => (
  <Badge tone={STATUS_TONE[status]} dot>
    {status}
  </Badge>
);
export const PriorityBadge = ({ priority }: { priority: TaskPriority }) => <Badge tone={PRIORITY_TONE[priority]}>{priority}</Badge>;
export const AttendanceBadge = ({ status }: { status: AttendanceStatus }) => (
  <Badge tone={ATTENDANCE_TONE[status]} dot>
    {ATTENDANCE_LABEL[status]}
  </Badge>
);
export const ReportStatusBadge = ({ status }: { status: ReportStatus }) => (
  <Badge tone={REPORT_TONE[status]} dot>
    {REPORT_LABEL[status]}
  </Badge>
);

/** Shows whether an attendance time came from the Android automation or was entered by hand. */
export function SourceBadge({ source }: { source: "automatic" | "manual" | null }) {
  if (!source) return null;
  const auto = source === "automatic";
  return (
    <span
      title={auto ? "Recorded automatically from device unlock/lock" : "Entered manually"}
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", auto ? TONE_CLASSES.teal : TONE_CLASSES.gray)}
    >
      {auto ? <Bot className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
      {auto ? "Auto" : "Manual"}
    </span>
  );
}

/** A <select> tinted by its current value — used for inline status/priority editing in the task grid. */
export function toneSelectClass(tone: Tone) {
  return cn("cell-input cursor-pointer rounded-full px-2 text-[12px] font-medium ring-1 ring-inset", TONE_CLASSES[tone]);
}
