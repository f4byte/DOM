// Device unlock/lock handling. An unlock/lock is only ever a *suggestion*; the user (or the auto-confirm setting) decides.
import type { UserSettings } from "../../../shared/constants";
import { localDate, localMinuteOfDay, parseHHMM, weekdayOf } from "../../../shared/time";
import { applyClock, getAttendanceByDate, type EventRow } from "./attendance";
import { badRequest, notFound } from "./http";

const MIN = 60_000;

/** Accepts ISO strings (with or without offset), "YYYY-MM-DD HH:MM[:SS]" (read as Dhaka time), epoch seconds or ms. */
export function normalizeTimestamp(input: string | number | undefined, nowMs = Date.now()): string {
  let ms: number;
  if (input === undefined || input === "") {
    ms = nowMs;
  } else if (typeof input === "number" || /^\d{9,13}(\.\d+)?$/.test(input)) {
    const n = Number(input);
    ms = n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  } else {
    let s = input.trim().replace(" ", "T");
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "+06:00";
    ms = Date.parse(s);
  }
  if (!Number.isFinite(ms)) throw badRequest("Invalid timestamp. Use ISO-8601 (e.g. 2026-11-05T09:58:00+06:00) or epoch seconds.");
  if (ms > nowMs + 10 * MIN) throw badRequest("Timestamp is in the future");
  if (ms < nowMs - 7 * 24 * 60 * MIN) throw badRequest("Timestamp is more than 7 days old");
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

export interface DeviceEventResult {
  accepted: boolean;
  status: "pending" | "ignored" | "confirmed" | "duplicate";
  reason?: string;
  eventId?: number;
  suggestedAction?: "login" | "logout" | null;
  autoConfirmed?: boolean;
}

interface Decision {
  status: "pending" | "ignored";
  action: "login" | "logout" | null;
  reason: string | null;
  workDate: string;
}

async function decide(db: D1Database, userId: number, s: UserSettings, type: "unlock" | "lock", occurredAt: string): Promise<Decision> {
  let workDate = localDate(occurredAt);
  const minute = localMinuteOfDay(occurredAt);

  if (type === "unlock") {
    const att = await getAttendanceByDate(db, userId, workDate);
    if (att?.first_login_at) return { status: "ignored", action: null, reason: "already_logged_in_today", workDate };
    if (!s.workingDays.includes(weekdayOf(workDate))) return { status: "ignored", action: null, reason: "non_working_day", workDate };
    if (minute < parseHHMM(s.loginWindowStart) || minute > parseHHMM(s.loginWindowEnd)) {
      return { status: "ignored", action: null, reason: "outside_login_window", workDate };
    }
    const pending = await db
      .prepare("SELECT id FROM attendance_events WHERE user_id = ? AND work_date = ? AND suggested_action = 'login' AND status = 'pending' LIMIT 1")
      .bind(userId, workDate)
      .first();
    if (pending) return { status: "ignored", action: null, reason: "login_already_suggested", workDate };
    return { status: "pending", action: "login", reason: null, workDate };
  }

  // lock → possible logout. Resolve which day's attendance this lock would close.
  let att = await getAttendanceByDate(db, userId, workDate);
  const crossMidnight = !att?.first_login_at;
  if (crossMidnight) {
    const since = new Date(new Date(occurredAt).getTime() - 20 * 60 * MIN).toISOString();
    att = await db
      .prepare(
        `SELECT * FROM attendance WHERE user_id = ? AND first_login_at IS NOT NULL AND last_logout_at IS NULL
            AND first_login_at < ? AND first_login_at >= ? ORDER BY first_login_at DESC LIMIT 1`,
      )
      .bind(userId, occurredAt, since)
      .first();
    if (att) workDate = att.work_date;
  }
  if (!att?.first_login_at) return { status: "ignored", action: null, reason: "no_login_today", workDate };
  if (!crossMidnight && minute < parseHHMM(s.logoutSuggestAfter)) return { status: "ignored", action: null, reason: "before_logout_window", workDate };
  if (att.last_logout_at && new Date(occurredAt) <= new Date(att.last_logout_at)) {
    return { status: "ignored", action: null, reason: "older_than_recorded_logout", workDate };
  }
  return { status: "pending", action: "logout", reason: null, workDate };
}

export async function processDeviceEvent(
  db: D1Database,
  userId: number,
  settings: UserSettings,
  ev: { type: "unlock" | "lock"; occurredAt: string; device?: string; raw?: unknown },
): Promise<DeviceEventResult> {
  // Webhook retries: same event type within a minute of an existing automatic event is a duplicate.
  const lo = new Date(new Date(ev.occurredAt).getTime() - 59_000).toISOString();
  const hi = new Date(new Date(ev.occurredAt).getTime() + 59_000).toISOString();
  const dup = await db
    .prepare("SELECT id FROM attendance_events WHERE user_id = ? AND event_type = ? AND source = 'automatic' AND occurred_at BETWEEN ? AND ? LIMIT 1")
    .bind(userId, ev.type, lo, hi)
    .first<{ id: number }>();
  if (dup) return { accepted: false, status: "duplicate", reason: "duplicate_event", eventId: dup.id };

  const d = await decide(db, userId, settings, ev.type, ev.occurredAt);

  if (d.action === "logout") {
    // Only the latest lock of the evening is the candidate logout.
    await db
      .prepare("UPDATE attendance_events SET status = 'superseded', resolved_at = ? WHERE user_id = ? AND work_date = ? AND suggested_action = 'logout' AND status = 'pending'")
      .bind(new Date().toISOString(), userId, d.workDate)
      .run();
  }

  const ins = await db
    .prepare(
      `INSERT INTO attendance_events (user_id, event_type, occurred_at, work_date, source, device_label, suggested_action, status, ignore_reason, raw_payload)
       VALUES (?, ?, ?, ?, 'automatic', ?, ?, ?, ?, ?)`,
    )
    .bind(userId, ev.type, ev.occurredAt, d.workDate, ev.device ?? null, d.action, d.status, d.reason, JSON.stringify(ev.raw ?? null).slice(0, 1000))
    .run();
  const eventId = ins.meta.last_row_id as number;

  if (d.status === "ignored") return { accepted: true, status: "ignored", reason: d.reason ?? undefined, eventId, suggestedAction: null };

  if (settings.autoConfirmDeviceEvents) {
    await confirmEvent(db, userId, settings, eventId);
    return { accepted: true, status: "confirmed", eventId, suggestedAction: d.action, autoConfirmed: true };
  }
  return { accepted: true, status: "pending", eventId, suggestedAction: d.action };
}

async function loadEvent(db: D1Database, userId: number, id: number): Promise<EventRow> {
  const ev = await db.prepare("SELECT * FROM attendance_events WHERE id = ? AND user_id = ?").bind(id, userId).first<EventRow>();
  if (!ev) throw notFound("Event not found");
  return ev;
}

/** Confirm a device event as a real login/logout (optionally overriding the suggestion). */
export async function confirmEvent(db: D1Database, userId: number, settings: UserSettings, id: number, override?: "login" | "logout") {
  const ev = await loadEvent(db, userId, id);
  if (ev.status === "confirmed") throw badRequest("Event is already confirmed");
  if (ev.source === "manual") throw badRequest("Manual events are already authoritative");
  const action = override ?? ev.suggested_action;
  if (!action) throw badRequest("Choose whether this event is a login or a logout");

  const { row } = await applyClock(db, userId, action, ev.occurred_at, "automatic", settings, `Confirmed device ${ev.event_type} event #${ev.id}`);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE attendance_events SET status = 'confirmed', suggested_action = ?, attendance_id = ?, resolved_at = ? WHERE id = ?").bind(action, row.id, now, ev.id),
    db
      .prepare("UPDATE attendance_events SET status = 'superseded', resolved_at = ? WHERE user_id = ? AND work_date = ? AND suggested_action = ? AND status = 'pending' AND id != ?")
      .bind(now, userId, ev.work_date, action, ev.id),
  ]);
  return row;
}

export async function rejectEvent(db: D1Database, userId: number, id: number): Promise<void> {
  const ev = await loadEvent(db, userId, id);
  if (ev.status === "confirmed") throw badRequest("A confirmed event cannot be rejected; correct the attendance instead");
  await db.prepare("UPDATE attendance_events SET status = 'rejected', resolved_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
}

/** Record a manual one-click login/logout as an already-confirmed event (for the source trail). */
export async function recordManualEvent(db: D1Database, userId: number, kind: "login" | "logout", occurredAt: string, workDate: string, attendanceId: number) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO attendance_events (user_id, event_type, occurred_at, work_date, source, suggested_action, status, attendance_id, resolved_at)
       VALUES (?, ?, ?, ?, 'manual', ?, 'confirmed', ?, ?)`,
    )
    .bind(userId, kind, occurredAt, workDate, kind, attendanceId, new Date().toISOString())
    .run();
}
