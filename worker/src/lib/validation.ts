import { z } from "zod";
import {
  DEV_AREAS,
  DEVICE_EVENT_TYPES,
  MANUAL_ATTENDANCE_STATUSES,
  REVIEW_ACTIONS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "../../../shared/constants";
import { isValidDate } from "../../../shared/time";

// Strip control characters (keeps \n and \t) so stored text is always printable.
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
export const text = (max = 5000) => z.string().max(max).transform(clean);
const title = (max = 200) => z.string().transform(clean).pipe(z.string().min(1, "Required").max(max));

export const dateStr = z.string().refine(isValidDate, "Must be a valid date (YYYY-MM-DD)");
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Must be YYYY-MM");
export const isoDateTime = z.string().datetime({ offset: true, message: "Must be an ISO-8601 timestamp" });
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const email = z.string().trim().toLowerCase().email("Invalid email").max(200);
export const password = z.string().min(10, "Use at least 10 characters").max(200);

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");

// ---------- Auth ----------
export const setupSchema = z.object({
  fullName: title(120),
  email,
  password,
  mentorName: text(120).optional(),
  setupKey: z.string().max(200).optional(),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });

// ---------- Tasks ----------
const taskBase = {
  title: title(200),
  description: text(5000),
  category: z.enum(TASK_CATEGORIES),
  assignedDate: dateStr,
  startTime: isoDateTime.nullable(),
  deadline: isoDateTime.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable(),
  actualMinutes: z.number().int().min(0).max(100_000).nullable(),
  progressPercent: z.number().int().min(0).max(100),
  implementationNotes: text(10_000),
  blockers: text(5000),
  completedAt: isoDateTime.nullable(),
  referenceUrl: z.union([httpUrl, z.literal("")]).nullable().transform((v) => (v ? v : null)),
};
export const taskCreateSchema = z.object(taskBase).partial().required({ title: true });
export const taskUpdateSchema = z.object(taskBase).partial().refine((o) => Object.keys(o).length > 0, "No fields to update");

// ---------- Attendance ----------
export const manualCorrectionSchema = z
  .object({
    firstLoginAt: isoDateTime.nullable().optional(),
    lastLogoutAt: isoDateTime.nullable().optional(),
    status: z.enum(MANUAL_ATTENDANCE_STATUSES).nullable().optional(),
    notes: text(1000).optional(),
    reason: z.string().transform(clean).pipe(z.string().min(3, "A reason is required for corrections").max(500)),
  })
  .refine((o) => o.firstLoginAt !== undefined || o.lastLogoutAt !== undefined || o.status !== undefined || o.notes !== undefined, "Nothing to correct");

// Manual clock-in/out always uses the server clock; backdating requires a correction with a reason.
export const clockSchema = z.object({ note: text(300).optional() }).default({});

export const confirmEventSchema = z.object({ action: z.enum(["login", "logout"]).optional() }).default({});

export const deviceEventSchema = z.object({
  event: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(DEVICE_EVENT_TYPES)),
  timestamp: z.union([z.string().max(64), z.number()]).optional(),
  device: z.string().max(80).transform(clean).optional(),
});

export const deviceTokenCreateSchema = z.object({ label: title(60) });

// ---------- Dev logs ----------
const devLogBase = {
  logDate: dateStr,
  area: z.enum(DEV_AREAS),
  taskId: z.number().int().positive().nullable(),
  implemented: text(5000),
  technologies: text(500),
  problems: text(5000),
  solutions: text(5000),
  status: z.enum(TASK_STATUSES),
  nextPlan: text(2000),
};
export const devLogCreateSchema = z.object(devLogBase).partial().required({ logDate: true, area: true });
export const devLogUpdateSchema = z.object(devLogBase).partial().refine((o) => Object.keys(o).length > 0, "No fields to update");

// ---------- Reports ----------
const reportItem = z.object({
  taskId: z.number().int().nullable().optional(),
  code: z.string().max(30).optional(),
  title: title(300),
  category: z.string().max(60).optional(),
  status: z.string().max(40).optional(),
  details: text(5000),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  timeSpentMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  reason: text(1000).optional(),
});
const lines = z.array(text(1500)).max(100);
export const reportContentSchema = z.object({
  summary: text(3000),
  completed: z.array(reportItem).max(100),
  inProgress: z.array(reportItem).max(100),
  pending: z.array(reportItem).max(100),
  technical: z.object({
    frontend: lines,
    backend: lines,
    database: lines,
    api: lines,
    testing: lines,
    deployment: lines,
    other: lines,
  }),
  challenges: z.array(z.object({ problem: text(2000), solution: text(2000) })).max(100),
  nextPlan: lines,
});
export const reportGenerateSchema = z.object({ date: dateStr, regenerate: z.boolean().optional() });
export const reportSaveSchema = z.object({ content: reportContentSchema });
export const reviewSchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  comment: text(3000).default(""),
});

// ---------- Settings ----------
export const settingsUpdateSchema = z
  .object({
    profile: z
      .object({ fullName: title(120), mentorName: text(120), employmentType: title(80) })
      .partial()
      .optional(),
    settings: z
      .object({
        officeStart: hhmm,
        officeEnd: hhmm,
        unpaidBreakMinutes: z.number().int().min(0).max(240),
        graceMinutes: z.number().int().min(0).max(120),
        countEarlyArrivalAsOvertime: z.boolean(),
        workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        automationEnabled: z.boolean(),
        autoConfirmDeviceEvents: z.boolean(),
        loginWindowStart: hhmm,
        loginWindowEnd: hhmm,
        logoutSuggestAfter: hhmm,
      })
      .partial()
      .optional(),
  })
  .refine((o) => o.profile || o.settings, "Nothing to update");

export const tlCreateSchema = z.object({ name: title(120), email, password });
