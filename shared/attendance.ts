// Attendance maths. Pure functions — used by the Worker (authoritative) and the UI (live clock) and unit-tested.
import type { AttendanceStatus } from "./constants";
import { localDate, localToUtcIso } from "./time";

const MIN = 60_000;

export interface ScheduleConfig {
  officeStart: string; // "HH:MM"
  officeEnd: string; // "HH:MM"
  unpaidBreakMinutes: number;
  graceMinutes: number;
  countEarlyArrivalAsOvertime: boolean;
}

export interface AttendanceCalcInput {
  workDate: string; // local YYYY-MM-DD the record belongs to
  loginAt: string | null; // UTC ISO
  logoutAt: string | null; // UTC ISO
  now?: Date;
}

export interface AttendanceCalc {
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  standardMinutes: number;
  /** Minutes until office end (0 once logged out or after office end). */
  remainingMinutes: number;
  /** Minutes still needed to reach the standard working duration. */
  shortfallMinutes: number;
  status: AttendanceStatus;
}

const floorMin = (ms: number) => Math.floor(ms / MIN);
/** Truncate an instant to the whole minute (seconds are ignored for office-time maths). */
const trunc = (iso: string) => Math.floor(new Date(iso).getTime() / MIN) * MIN;

export function standardMinutes(cfg: ScheduleConfig): number {
  const start = localToUtcIso("2000-01-03", cfg.officeStart);
  const end = localToUtcIso("2000-01-03", cfg.officeEnd);
  return floorMin(new Date(end).getTime() - new Date(start).getTime());
}

export function calculateAttendance(input: AttendanceCalcInput, cfg: ScheduleConfig): AttendanceCalc {
  const now = input.now ?? new Date();
  const startMs = new Date(localToUtcIso(input.workDate, cfg.officeStart)).getTime();
  const endMs = new Date(localToUtcIso(input.workDate, cfg.officeEnd)).getTime();
  const std = floorMin(endMs - startMs);

  const result: AttendanceCalc = {
    lateMinutes: 0,
    earlyArrivalMinutes: 0,
    earlyDepartureMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: 0,
    standardMinutes: std,
    remainingMinutes: 0,
    shortfallMinutes: 0,
    status: "absent",
  };
  if (!input.loginAt) return result;

  const loginMs = trunc(input.loginAt);
  const loggedOut = !!input.logoutAt;
  const outMs = loggedOut ? trunc(input.logoutAt as string) : Math.max(loginMs, Math.floor(now.getTime() / MIN) * MIN);

  const diffStart = floorMin(loginMs - startMs);
  const lateRaw = diffStart > 0 ? diffStart : 0;
  result.lateMinutes = lateRaw > cfg.graceMinutes ? lateRaw : 0;
  result.earlyArrivalMinutes = diffStart < 0 ? -diffStart : 0;

  const span = Math.max(0, floorMin(outMs - loginMs));
  result.workedMinutes = Math.max(0, span - (cfg.unpaidBreakMinutes || 0));

  if (loggedOut) {
    const diffEnd = floorMin(outMs - endMs);
    result.earlyDepartureMinutes = diffEnd < 0 ? -diffEnd : 0;
    result.overtimeMinutes =
      (diffEnd > 0 ? diffEnd : 0) + (cfg.countEarlyArrivalAsOvertime ? result.earlyArrivalMinutes : 0);
    result.remainingMinutes = 0;
  } else {
    result.remainingMinutes = Math.max(0, floorMin(endMs - Math.floor(now.getTime() / MIN) * MIN));
  }
  result.shortfallMinutes = Math.max(0, std - (cfg.unpaidBreakMinutes || 0) - result.workedMinutes);

  if (!loggedOut) {
    result.status = input.workDate === localDate(now) ? "in_progress" : "missing_logout";
  } else if (result.lateMinutes > 0 && result.earlyDepartureMinutes > 0) {
    result.status = "late_early_leave";
  } else if (result.lateMinutes > 0) {
    result.status = "late";
  } else if (result.earlyDepartureMinutes > 0) {
    result.status = "early_leave";
  } else if (result.overtimeMinutes > 0) {
    result.status = "overtime";
  } else {
    result.status = "present";
  }
  return result;
}

export function scheduleFromSettings(s: {
  officeStart: string;
  officeEnd: string;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  countEarlyArrivalAsOvertime: boolean;
}): ScheduleConfig {
  return {
    officeStart: s.officeStart,
    officeEnd: s.officeEnd,
    unpaidBreakMinutes: s.unpaidBreakMinutes,
    graceMinutes: s.graceMinutes,
    countEarlyArrivalAsOvertime: s.countEarlyArrivalAsOvertime,
  };
}
