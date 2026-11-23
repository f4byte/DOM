// Timezone helpers. Storage is always UTC ISO-8601; calculations/display use Asia/Dhaka (UTC+6, no DST).
import { UTC_OFFSET_MINUTES } from "./constants";

const MIN = 60_000;

/** Local (Dhaka) calendar date "YYYY-MM-DD" for an instant. */
export function localDate(input: string | Date | number, offsetMin = UTC_OFFSET_MINUTES): string {
  const t = new Date(input).getTime() + offsetMin * MIN;
  return new Date(t).toISOString().slice(0, 10);
}

/** Minutes since local midnight for an instant. */
export function localMinuteOfDay(input: string | Date | number, offsetMin = UTC_OFFSET_MINUTES): number {
  const t = new Date(input).getTime() + offsetMin * MIN;
  const d = new Date(t);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function parseHHMM(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) throw new Error(`Invalid time "${v}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Convert a local date + "HH:MM" to a UTC ISO string. */
export function localToUtcIso(date: string, hhmm: string, offsetMin = UTC_OFFSET_MINUTES): string {
  const [y, mo, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, mo - 1, d, 0, 0, 0) + parseHHMM(hhmm) * MIN - offsetMin * MIN;
  return new Date(ms).toISOString();
}

/** Convert "YYYY-MM-DDTHH:MM" (datetime-local, Dhaka wall clock) to UTC ISO. */
export function localDateTimeToUtcIso(v: string, offsetMin = UTC_OFFSET_MINUTES): string {
  const [date, time] = v.split("T");
  return localToUtcIso(date, time.slice(0, 5), offsetMin);
}

/** UTC ISO → "YYYY-MM-DDTHH:MM" Dhaka wall clock (for datetime-local inputs). */
export function utcIsoToLocalDateTime(iso: string, offsetMin = UTC_OFFSET_MINUTES): string {
  const t = new Date(iso).getTime() + offsetMin * MIN;
  return new Date(t).toISOString().slice(0, 16);
}

/** UTC ISO → "HH:MM" Dhaka wall clock. */
export function utcIsoToLocalTime(iso: string, offsetMin = UTC_OFFSET_MINUTES): string {
  return utcIsoToLocalDateTime(iso, offsetMin).slice(11, 16);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function nextWorkingDay(date: string, workingDays: number[]): string {
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return addDays(date, 1);
}

export function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function isValidDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 495 → "8h 15m", 45 → "45m", 0 → "0m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

/** "HH:MM" → "10:00 AM". */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
