// Display formatting. Everything is rendered in Asia/Dhaka regardless of the device's own timezone.
import { TIMEZONE } from "@shared/constants";
import { formatDuration, localDate } from "@shared/time";

export { formatDuration, localDate };

const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true });
const fmtTimeSec = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
const fmtDateShort = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const fmtDateLong = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });

export const timeOf = (iso: string | null | undefined) => (iso ? fmtTime.format(new Date(iso)) : "—");
export const timeWithSeconds = (d: Date) => fmtTimeSec.format(d);
/** "2026-11-05" → "05 Nov 2026" (pure calendar date, no timezone shift). */
export const dateShort = (d: string | null | undefined) => (d ? fmtDateShort.format(new Date(`${d}T00:00:00Z`)) : "—");
export const dateLong = (d: string) => fmtDateLong.format(new Date(`${d}T00:00:00Z`));
export const weekdayShort = (d: string) => fmtWeekday.format(new Date(`${d}T00:00:00Z`));
export const dateTimeOf = (iso: string | null | undefined) => (iso ? `${dateShort(localDate(iso))}, ${timeOf(iso)}` : "—");

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(now)) % 24;
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export const hoursText = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

export const AREA_LABEL: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  api: "API & Integration",
  testing: "Testing & Debugging",
  deployment: "Deployment",
  other: "Other technical work",
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
