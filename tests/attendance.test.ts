import { describe, expect, it } from "vitest";
import { calculateAttendance, standardMinutes, type ScheduleConfig } from "../shared/attendance";
import {
  addDays,
  formatDuration,
  localDate,
  localDateTimeToUtcIso,
  localToUtcIso,
  nextWorkingDay,
  utcIsoToLocalDateTime,
  weekdayOf,
} from "../shared/time";

const cfg: ScheduleConfig = {
  officeStart: "10:00",
  officeEnd: "19:00",
  unpaidBreakMinutes: 0,
  graceMinutes: 0,
  countEarlyArrivalAsOvertime: false,
};
const D = "2026-11-05"; // a Thursday
const at = (hhmm: string) => localToUtcIso(D, hhmm);
const calc = (inn: string | null, out: string | null, c: Partial<ScheduleConfig> = {}) =>
  calculateAttendance({ workDate: D, loginAt: inn && at(inn), logoutAt: out && at(out), now: new Date("2026-11-06T00:00:00Z") }, { ...cfg, ...c });

describe("attendance calculation — spec examples", () => {
  it("1) 9:45 → 7:30 PM: 15m early arrival, 30m overtime (early arrival NOT double counted)", () => {
    const r = calc("09:45", "19:30");
    expect(r.earlyArrivalMinutes).toBe(15);
    expect(r.overtimeMinutes).toBe(30);
    expect(r.lateMinutes).toBe(0);
    expect(r.earlyDepartureMinutes).toBe(0);
    expect(r.status).toBe("overtime");
  });
  it("2) 10:30 → 6:30 PM: 30m late, 30m early departure", () => {
    const r = calc("10:30", "18:30");
    expect(r.lateMinutes).toBe(30);
    expect(r.earlyDepartureMinutes).toBe(30);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.status).toBe("late_early_leave");
  });
  it("3) 10:00 → 8:00 PM: 1 hour overtime", () => {
    const r = calc("10:00", "20:00");
    expect(r.overtimeMinutes).toBe(60);
    expect(r.workedMinutes).toBe(600);
  });
  it("4) 10:00 → 7:00 PM: regular schedule completed", () => {
    const r = calc("10:00", "19:00");
    expect(r).toMatchObject({ lateMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0, workedMinutes: 540, status: "present" });
  });
});

describe("attendance calculation — configuration & edge cases", () => {
  it("standard duration is 9h", () => expect(standardMinutes(cfg)).toBe(540));
  it("early arrival counts as overtime only when configured", () => {
    expect(calc("09:45", "19:30", { countEarlyArrivalAsOvertime: true }).overtimeMinutes).toBe(45);
  });
  it("grace period suppresses small lateness", () => {
    expect(calc("10:05", "19:00", { graceMinutes: 10 }).lateMinutes).toBe(0);
    expect(calc("10:15", "19:00", { graceMinutes: 10 }).lateMinutes).toBe(15);
  });
  it("unpaid break is deducted from worked time", () => {
    expect(calc("10:00", "19:00", { unpaidBreakMinutes: 60 }).workedMinutes).toBe(480);
  });
  it("seconds are ignored", () => {
    const r = calculateAttendance(
      { workDate: D, loginAt: localToUtcIso(D, "10:00").replace(":00.000Z", ":59.000Z"), logoutAt: at("19:00") },
      cfg,
    );
    expect(r.lateMinutes).toBe(0);
  });
  it("no login → absent with zeros", () => {
    expect(calc(null, null)).toMatchObject({ status: "absent", workedMinutes: 0 });
  });
  it("login without logout today → in_progress with live duration and remaining time", () => {
    const now = new Date(localToUtcIso(D, "14:30"));
    const r = calculateAttendance({ workDate: D, loginAt: at("10:00"), logoutAt: null, now }, cfg);
    expect(r.status).toBe("in_progress");
    expect(r.workedMinutes).toBe(270);
    expect(r.remainingMinutes).toBe(270);
    expect(r.earlyDepartureMinutes).toBe(0);
  });
  it("login without logout on a past day → missing_logout", () => {
    const now = new Date(localToUtcIso("2026-11-06", "09:00"));
    expect(calculateAttendance({ workDate: D, loginAt: at("10:00"), logoutAt: null, now }, cfg).status).toBe("missing_logout");
  });
});

describe("timezone helpers (Asia/Dhaka, UTC+6)", () => {
  it("converts local wall clock to UTC", () => {
    expect(localToUtcIso("2026-11-05", "10:00")).toBe("2026-11-05T04:00:00.000Z");
    expect(localToUtcIso("2026-11-05", "00:30")).toBe("2026-11-04T18:30:00.000Z");
  });
  it("local date rolls over at 18:00 UTC", () => {
    expect(localDate("2026-11-05T17:59:00Z")).toBe("2026-11-05");
    expect(localDate("2026-11-05T18:00:00Z")).toBe("2026-11-06");
  });
  it("datetime-local round trip", () => {
    const iso = localDateTimeToUtcIso("2026-11-05T14:00");
    expect(iso).toBe("2026-11-05T08:00:00.000Z");
    expect(utcIsoToLocalDateTime(iso)).toBe("2026-11-05T14:00");
  });
  it("date arithmetic and working days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-05")).toBe(4);
    expect(nextWorkingDay("2026-11-06", [1, 2, 3, 4, 5])).toBe("2026-11-09"); // Fri → Mon
    expect(nextWorkingDay("2026-11-05", [0, 1, 2, 3, 4])).toBe("2026-11-08"); // Thu → Sun
  });
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(495)).toBe("8h 15m");
  });
});
