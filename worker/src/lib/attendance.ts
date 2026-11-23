// Attendance service: single place where login/logout is applied, recalculated and audited.
import { calculateAttendance, scheduleFromSettings } from "../../../shared/attendance";
import type { AttendanceStatus, UserSettings } from "../../../shared/constants";
import type { AttendanceDTO, AttendanceEventDTO } from "../../../shared/types";
import { localDate } from "../../../shared/time";
import { badRequest, conflict } from "./http";

export interface AttendanceRow {
  id: number;
  user_id: number;
  work_date: string;
  first_login_at: string | null;
  last_logout_at: string | null;
  late_minutes: number;
  early_arrival_minutes: number;
  early_departure_minutes: number;
  overtime_minutes: number;
  worked_minutes: number;
  status: AttendanceStatus;
  status_manual: number;
  login_source: "automatic" | "manual" | null;
  logout_source: "automatic" | "manual" | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  user_id: number;
  event_type: AttendanceEventDTO["eventType"];
  occurred_at: string;
  work_date: string;
  source: "automatic" | "manual";
  device_label: string | null;
  suggested_action: "login" | "logout" | null;
  status: AttendanceEventDTO["status"];
  ignore_reason: string | null;
  attendance_id: number | null;
  created_at: string;
}

export const toEventDTO = (e: EventRow): AttendanceEventDTO => ({
  id: e.id,
  eventType: e.event_type,
  occurredAt: e.occurred_at,
  workDate: e.work_date,
  source: e.source,
  deviceLabel: e.device_label,
  suggestedAction: e.suggested_action,
  status: e.status,
  ignoreReason: e.ignore_reason,
  createdAt: e.created_at,
});

export async function getAttendanceByDate(db: D1Database, userId: number, date: string): Promise<AttendanceRow | null> {
  return db.prepare("SELECT * FROM attendance WHERE user_id = ? AND work_date = ?").bind(userId, date).first<AttendanceRow>();
}

/** Build the API representation. Completed days use their frozen stored values; open days are computed live. */
export function toAttendanceDTO(row: AttendanceRow | null, workDate: string, settings: UserSettings, now = new Date()): AttendanceDTO {
  const cfg = scheduleFromSettings(settings);
  const calc = calculateAttendance({ workDate, loginAt: row?.first_login_at ?? null, logoutAt: row?.last_logout_at ?? null, now }, cfg);
  const base = {
    workDate,
    standardMinutes: calc.standardMinutes,
    loginSource: row?.login_source ?? null,
    logoutSource: row?.logout_source ?? null,
    notes: row?.notes ?? "",
    statusManual: !!row?.status_manual,
  };
  if (!row) {
    return { ...base, id: null, firstLoginAt: null, lastLogoutAt: null, lateMinutes: 0, earlyArrivalMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, remainingMinutes: 0, shortfallMinutes: 0, status: "absent" };
  }
  if (!row.first_login_at) {
    return { ...base, id: row.id, firstLoginAt: null, lastLogoutAt: null, lateMinutes: 0, earlyArrivalMinutes: 0, earlyDepartureMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, remainingMinutes: 0, shortfallMinutes: 0, status: row.status };
  }
  const frozen = !!row.last_logout_at;
  return {
    ...base,
    id: row.id,
    firstLoginAt: row.first_login_at,
    lastLogoutAt: row.last_logout_at,
    lateMinutes: frozen ? row.late_minutes : calc.lateMinutes,
    earlyArrivalMinutes: calc.earlyArrivalMinutes,
    earlyDepartureMinutes: frozen ? row.early_departure_minutes : 0,
    overtimeMinutes: frozen ? row.overtime_minutes : 0,
    workedMinutes: frozen ? row.worked_minutes : calc.workedMinutes,
    remainingMinutes: calc.remainingMinutes,
    shortfallMinutes: calc.shortfallMinutes,
    status: frozen ? row.status : calc.status,
  };
}

async function audit(
  db: D1Database,
  attendanceId: number,
  userId: number,
  action: string,
  field: string | null,
  oldV: string | null,
  newV: string | null,
  reason: string | null,
  source: "automatic" | "manual",
) {
  await db
    .prepare("INSERT INTO attendance_audit_logs (attendance_id, user_id, action, field, old_value, new_value, reason, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(attendanceId, userId, action, field, oldV, newV, reason, source)
    .run();
}

/** Recompute and persist the derived columns for a row. */
async function recalc(db: D1Database, userId: number, id: number, settings: UserSettings): Promise<AttendanceRow> {
  const row = (await db.prepare("SELECT * FROM attendance WHERE id = ? AND user_id = ?").bind(id, userId).first<AttendanceRow>())!;
  if (!row.first_login_at) return row;
  const calc = calculateAttendance({ workDate: row.work_date, loginAt: row.first_login_at, logoutAt: row.last_logout_at }, scheduleFromSettings(settings));
  await db
    .prepare(
      `UPDATE attendance SET late_minutes = ?, early_arrival_minutes = ?, early_departure_minutes = ?, overtime_minutes = ?,
              worked_minutes = ?, status = ?, status_manual = 0, updated_at = ? WHERE id = ?`,
    )
    .bind(calc.lateMinutes, calc.earlyArrivalMinutes, calc.earlyDepartureMinutes, calc.overtimeMinutes, calc.workedMinutes, calc.status, new Date().toISOString(), id)
    .run();
  return (await db.prepare("SELECT * FROM attendance WHERE id = ?").bind(id).first<AttendanceRow>())!;
}

export interface ClockResult {
  row: AttendanceRow;
  changed: boolean;
}

/** Apply a login or logout. Idempotent: duplicates never create a second attendance record. */
export async function applyClock(
  db: D1Database,
  userId: number,
  kind: "login" | "logout",
  atIso: string,
  source: "automatic" | "manual",
  settings: UserSettings,
  reason: string | null = null,
): Promise<ClockResult> {
  const now = new Date().toISOString();
  if (kind === "login") {
    const workDate = localDate(atIso);
    let row = await getAttendanceByDate(db, userId, workDate);
    if (!row) {
      // INSERT OR IGNORE + UNIQUE(user_id, work_date) makes concurrent duplicates harmless.
      await db
        .prepare("INSERT OR IGNORE INTO attendance (user_id, work_date, first_login_at, login_source, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_progress', ?, ?)")
        .bind(userId, workDate, atIso, source, now, now)
        .run();
      row = (await getAttendanceByDate(db, userId, workDate))!;
      await audit(db, row.id, userId, "clock_in", "first_login_at", null, row.first_login_at, reason, source);
    } else if (!row.first_login_at) {
      await db.prepare("UPDATE attendance SET first_login_at = ?, login_source = ?, status_manual = 0, updated_at = ? WHERE id = ?").bind(atIso, source, now, row.id).run();
      await audit(db, row.id, userId, "clock_in", "first_login_at", null, atIso, reason, source);
    } else if (new Date(atIso) < new Date(row.first_login_at)) {
      await db.prepare("UPDATE attendance SET first_login_at = ?, login_source = ?, updated_at = ? WHERE id = ?").bind(atIso, source, now, row.id).run();
      await audit(db, row.id, userId, "clock_in", "first_login_at", row.first_login_at, atIso, reason, source);
    } else {
      return { row, changed: false };
    }
    return { row: await recalc(db, userId, row.id, settings), changed: true };
  }

  // logout
  let row = await getAttendanceByDate(db, userId, localDate(atIso));
  if (!row || !row.first_login_at) {
    // Past-midnight logout belongs to the most recent still-open day within 20 hours.
    const since = new Date(new Date(atIso).getTime() - 20 * 3_600_000).toISOString();
    row = await db
      .prepare(
        `SELECT * FROM attendance WHERE user_id = ? AND first_login_at IS NOT NULL AND last_logout_at IS NULL
            AND first_login_at < ? AND first_login_at >= ? ORDER BY first_login_at DESC LIMIT 1`,
      )
      .bind(userId, atIso, since)
      .first<AttendanceRow>();
  }
  if (!row || !row.first_login_at) throw conflict("No login recorded for this day. Clock in first, or add the day with a manual correction.", "no_login");
  if (new Date(atIso) <= new Date(row.first_login_at)) throw badRequest("Logout must be after the login time");
  if (row.last_logout_at && new Date(atIso) <= new Date(row.last_logout_at)) return { row, changed: false };
  await db.prepare("UPDATE attendance SET last_logout_at = ?, logout_source = ?, updated_at = ? WHERE id = ?").bind(atIso, source, now, row.id).run();
  await audit(db, row.id, userId, "clock_out", "last_logout_at", row.last_logout_at, atIso, reason, source);
  return { row: await recalc(db, userId, row.id, settings), changed: true };
}

export interface CorrectionInput {
  firstLoginAt?: string | null;
  lastLogoutAt?: string | null;
  status?: "leave" | "holiday" | "absent" | null;
  notes?: string;
  reason: string;
}

/** Manual correction with mandatory reason; every changed field is audited. */
export async function correctAttendance(db: D1Database, userId: number, date: string, input: CorrectionInput, settings: UserSettings): Promise<AttendanceRow> {
  const now = new Date().toISOString();
  let row = await getAttendanceByDate(db, userId, date);
  const oldLogin = row?.first_login_at ?? null;
  const oldLogout = row?.last_logout_at ?? null;

  let login = input.firstLoginAt !== undefined ? input.firstLoginAt : oldLogin;
  let logout = input.lastLogoutAt !== undefined ? input.lastLogoutAt : oldLogout;
  const manualStatus = input.status ?? null;

  if (manualStatus) {
    if (input.firstLoginAt || input.lastLogoutAt) throw badRequest("A leave/holiday/absent status cannot be combined with clock times");
    login = null;
    logout = null;
  }
  if (logout && !login) throw badRequest("A logout time needs a login time");
  if (login && localDate(login) !== date) throw badRequest(`Login time must fall on ${date} (Asia/Dhaka)`);
  if (login && logout) {
    const span = new Date(logout).getTime() - new Date(login).getTime();
    if (span <= 0) throw badRequest("Logout must be after login");
    if (span > 24 * 3_600_000) throw badRequest("Login and logout cannot be more than 24 hours apart");
  }

  const created = !row;
  if (!row) {
    const initialStatus: AttendanceStatus = manualStatus ?? "present";
    await db
      .prepare("INSERT INTO attendance (user_id, work_date, status, status_manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, date, initialStatus, manualStatus ? 1 : 0, now, now)
      .run();
    row = (await getAttendanceByDate(db, userId, date))!;
  }

  const changes: Array<[string, string | null, string | null]> = [];
  if ((oldLogin ?? null) !== (login ?? null)) changes.push(["first_login_at", oldLogin, login]);
  if ((oldLogout ?? null) !== (logout ?? null)) changes.push(["last_logout_at", oldLogout, logout]);
  // A newly created row is already inserted with the manual status, so record it explicitly.
  if (manualStatus && (created || row.status !== manualStatus)) changes.push(["status", created ? null : row.status, manualStatus]);
  if (input.status === null && row.status_manual) changes.push(["status", row.status, "(recalculated)"]);
  if (input.notes !== undefined && input.notes !== row.notes) changes.push(["notes", row.notes, input.notes]);
  if (changes.length === 0) throw badRequest("No changes were made");

  await db
    .prepare(
      `UPDATE attendance SET first_login_at = ?, last_logout_at = ?, notes = ?, status = ?, status_manual = ?,
              login_source = CASE WHEN ? THEN 'manual' ELSE login_source END,
              logout_source = CASE WHEN ? THEN 'manual' ELSE logout_source END,
              late_minutes = 0, early_arrival_minutes = 0, early_departure_minutes = 0, overtime_minutes = 0, worked_minutes = 0,
              updated_at = ? WHERE id = ?`,
    )
    .bind(
      login,
      logout,
      input.notes ?? row.notes,
      manualStatus ?? row.status,
      manualStatus ? 1 : 0,
      (oldLogin ?? null) !== (login ?? null) ? 1 : 0,
      (oldLogout ?? null) !== (logout ?? null) ? 1 : 0,
      now,
      row.id,
    )
    .run();
  for (const [field, o, n] of changes) await audit(db, row.id, userId, "manual_correction", field, o, n, input.reason, "manual");

  if (login) return recalc(db, userId, row.id, settings);
  return (await db.prepare("SELECT * FROM attendance WHERE id = ?").bind(row.id).first<AttendanceRow>())!;
}
