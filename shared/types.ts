// DTOs shared between the Worker API and the React app (JSON wire format, camelCase).
import type {
  AttendanceStatus,
  ReportStatus,
  ReviewAction,
  TaskPriority,
  TaskStatus,
  UserSettings,
} from "./constants";

export interface TaskDTO {
  id: number;
  code: string;
  title: string;
  description: string;
  category: string;
  assignedDate: string;
  startTime: string | null;
  deadline: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  progressPercent: number;
  implementationNotes: string;
  blockers: string;
  completedAt: string | null;
  referenceUrl: string | null;
  createdAt: string;
  updatedAt: string;
  isOverdue: boolean;
}

export interface TaskActivityDTO {
  id: number;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface AttendanceDTO {
  id: number | null;
  workDate: string;
  firstLoginAt: string | null;
  lastLogoutAt: string | null;
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  standardMinutes: number;
  remainingMinutes: number;
  shortfallMinutes: number;
  status: AttendanceStatus;
  statusManual: boolean;
  loginSource: "automatic" | "manual" | null;
  logoutSource: "automatic" | "manual" | null;
  notes: string;
}

export interface AttendanceDayDTO {
  date: string;
  weekday: number;
  isWorkingDay: boolean;
  /** "absent" is virtual (a past working day with no record); "weekend"/"future"/"before_start" are placeholders. */
  placeholder: "absent" | "weekend" | "future" | "before_start" | null;
  record: AttendanceDTO | null;
}

export interface AttendanceEventDTO {
  id: number;
  eventType: "unlock" | "lock" | "login" | "logout";
  occurredAt: string;
  workDate: string;
  source: "automatic" | "manual";
  deviceLabel: string | null;
  suggestedAction: "login" | "logout" | null;
  status: "pending" | "confirmed" | "rejected" | "ignored" | "superseded";
  ignoreReason: string | null;
  createdAt: string;
}

export interface AttendanceAuditDTO {
  id: number;
  workDate: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  source: "automatic" | "manual";
  createdAt: string;
}

export interface DevLogDTO {
  id: number;
  logDate: string;
  area: string;
  taskId: number | null;
  taskCode: string | null;
  taskTitle: string | null;
  implemented: string;
  technologies: string;
  problems: string;
  solutions: string;
  status: TaskStatus;
  nextPlan: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Reports ----------

export interface ReportTaskItem {
  taskId?: number | null;
  code?: string;
  title: string;
  category?: string;
  status?: string;
  details: string;
  progress?: number | null;
  timeSpentMinutes?: number | null;
  reason?: string;
}

export interface ReportContent {
  summary: string;
  completed: ReportTaskItem[];
  inProgress: ReportTaskItem[];
  pending: ReportTaskItem[];
  technical: {
    frontend: string[];
    backend: string[];
    database: string[];
    api: string[];
    testing: string[];
    deployment: string[];
    other: string[];
  };
  challenges: { problem: string; solution: string }[];
  nextPlan: string[];
}

export interface ReportHeader {
  employeeName: string;
  mentorName: string;
  employmentType: string;
  date: string;
  generatedAt: string;
  attendance: {
    status: AttendanceStatus;
    loginAt: string | null;
    logoutAt: string | null;
    workedMinutes: number;
    lateMinutes: number;
    earlyArrivalMinutes: number;
    earlyDepartureMinutes: number;
    overtimeMinutes: number;
  } | null;
}

export interface ReviewDTO {
  id: number;
  reviewerName: string;
  action: ReviewAction | "viewed";
  comment: string;
  createdAt: string;
}

export interface ReportDTO {
  id: number;
  reportDate: string;
  revision: number;
  status: ReportStatus;
  locked: boolean;
  header: ReportHeader;
  content: ReportContent;
  shareToken: string;
  submittedAt: string | null;
  viewedAt: string | null;
  reviewedAt: string | null;
  hasPdf: boolean;
  createdAt: string;
  updatedAt: string;
  reviews?: ReviewDTO[];
  /** Set on TL lists. */
  internName?: string;
}

export interface PublicReportDTO {
  report: ReportDTO;
  reviews: ReviewDTO[];
  latest: { revision: number; token: string; status: ReportStatus } | null;
}

// ---------- Settings / profile ----------

export interface ProfileDTO {
  fullName: string;
  email: string;
  employmentType: string;
  mentorName: string;
  role: "intern" | "tl" | "admin";
}

export interface DeviceTokenDTO {
  id: number;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface SettingsResponse {
  profile: ProfileDTO;
  settings: UserSettings;
  tl: { id: number; name: string; email: string } | null;
  deviceTokens: DeviceTokenDTO[];
  meta: { r2Enabled: boolean; appName: string; timezone: string };
}

export interface DashboardDTO {
  date: string;
  fullName: string;
  attendance: AttendanceDTO;
  schedule: { officeStart: string; officeEnd: string };
  pendingEventCount: number;
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    assignedToday: number;
    completionPercent: number;
    overdue: number;
  };
  byStatus: { status: string; count: number }[];
  byCategory: { category: string; count: number }[];
  trend: { date: string; workedMinutes: number; overtimeMinutes: number; tasksCompleted: number }[];
  upcoming: TaskDTO[];
  report: { id: number; status: ReportStatus; revision: number } | null;
}

export interface AnalyticsDTO {
  from: string;
  to: string;
  attendance: {
    days: { date: string; workedMinutes: number; overtimeMinutes: number; lateMinutes: number; earlyDepartureMinutes: number; status: AttendanceStatus }[];
    totalWorkedMinutes: number;
    totalOvertimeMinutes: number;
    totalLateMinutes: number;
    totalEarlyDepartureMinutes: number;
    daysAttended: number;
    onTimeDays: number;
    lateDays: number;
    averageWorkedMinutes: number;
  };
  tasks: {
    total: number;
    completed: number;
    byCategory: { category: string; total: number; completed: number; actualMinutes: number }[];
    byStatus: { status: string; count: number }[];
    byPriority: { priority: string; count: number }[];
    completedPerDay: { date: string; count: number }[];
    completedOnTime: number;
    completedLate: number;
  };
  reports: { total: number; byStatus: { status: string; count: number }[] };
}

export interface AuthUserDTO {
  id: number;
  email: string;
  role: "intern" | "tl" | "admin";
  fullName: string;
}
