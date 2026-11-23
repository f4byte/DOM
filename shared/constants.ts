// Shared enums & defaults used by both the Worker API and the React app.

export const TASK_CATEGORIES = [
  "Frontend Development",
  "Backend Development",
  "Full-stack Development",
  "Database Management",
  "API Integration",
  "Bug Fixing",
  "Testing & Debugging",
  "Deployment",
  "Research & Learning",
  "Documentation",
  "Other",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = [
  "Not Started",
  "In Progress",
  "Under Review",
  "Completed",
  "On Hold",
  "Blocked",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DEV_AREAS = [
  "Frontend Implementation",
  "Backend Implementation",
  "Database Implementation",
  "API Development",
  "Integration",
  "Testing",
  "Deployment",
] as const;
export type DevArea = (typeof DEV_AREAS)[number];

export const REPORT_STATUSES = [
  "draft",
  "submitted",
  "viewed",
  "reviewed",
  "revision_requested",
  "approved",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REVIEW_ACTIONS = ["comment", "reviewed", "revision_requested", "approved"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const ATTENDANCE_STATUSES = [
  "present",
  "late",
  "early_leave",
  "late_early_leave",
  "overtime",
  "in_progress",
  "missing_logout",
  "leave",
  "holiday",
  "absent",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
/** Statuses the user may set by hand (no clock times needed). */
export const MANUAL_ATTENDANCE_STATUSES = ["leave", "holiday", "absent"] as const;

export const DEVICE_EVENT_TYPES = ["unlock", "lock"] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** Asia/Dhaka is UTC+6 with no daylight saving. */
export const TIMEZONE = "Asia/Dhaka";
export const UTC_OFFSET_MINUTES = 360;

export interface UserSettings {
  officeStart: string; // "HH:MM" local
  officeEnd: string; // "HH:MM" local
  unpaidBreakMinutes: number;
  graceMinutes: number;
  countEarlyArrivalAsOvertime: boolean;
  workingDays: number[]; // 0=Sun … 6=Sat
  automationEnabled: boolean;
  autoConfirmDeviceEvents: boolean;
  loginWindowStart: string; // earliest local time an unlock may suggest a login
  loginWindowEnd: string; // latest local time an unlock may suggest a login
  logoutSuggestAfter: string; // locks before this local time are ignored
}

export const DEFAULT_SETTINGS: UserSettings = {
  officeStart: "10:00",
  officeEnd: "19:00",
  unpaidBreakMinutes: 0,
  graceMinutes: 0,
  countEarlyArrivalAsOvertime: false,
  // Mon–Fri is the neutral default; change it in Settings (e.g. Sun–Thu).
  workingDays: [1, 2, 3, 4, 5],
  automationEnabled: true,
  autoConfirmDeviceEvents: false,
  loginWindowStart: "06:00",
  loginWindowEnd: "13:00",
  logoutSuggestAfter: "16:00",
};

export const PRIORITY_ORDER: Record<string, number> = { Low: 0, Medium: 1, High: 2, Urgent: 3 };
