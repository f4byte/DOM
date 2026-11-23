import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AttendanceAuditDTO, AttendanceDayDTO, AttendanceDTO, AttendanceEventDTO } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { timeOf } from "@/lib/format";

export interface TodayResponse {
  date: string;
  attendance: AttendanceDTO;
  pendingEvents: AttendanceEventDTO[];
  automationEnabled: boolean;
  schedule: { officeStart: string; officeEnd: string };
}

export const useTodayAttendance = () =>
  useQuery({ queryKey: ["attendance", "today"], queryFn: () => api.get<TodayResponse>("/attendance/today"), refetchInterval: 60_000 });

/** Mutations that change attendance. Every one refreshes everything that displays attendance. */
export function useAttendanceActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["attendance", "dashboard", "analytics"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const clockIn = useMutation({
    mutationFn: () => api.post<{ changed: boolean; attendance: AttendanceDTO }>("/attendance/clock-in"),
    onSuccess: (r) => {
      toast.success(r.changed ? `Clocked in at ${timeOf(r.attendance.firstLoginAt)}` : `Already clocked in at ${timeOf(r.attendance.firstLoginAt)}`);
      refresh();
    },
    onError,
  });
  const clockOut = useMutation({
    mutationFn: () => api.post<{ changed: boolean; attendance: AttendanceDTO }>("/attendance/clock-out"),
    onSuccess: (r) => {
      toast.success(`Clocked out at ${timeOf(r.attendance.lastLogoutAt)}`);
      refresh();
    },
    onError,
  });
  const confirmEvent = useMutation({
    mutationFn: (v: { id: number; action?: "login" | "logout" }) => api.post(`/attendance/events/${v.id}/confirm`, v.action ? { action: v.action } : {}),
    onSuccess: () => {
      toast.success("Attendance updated from device event");
      refresh();
    },
    onError,
  });
  const rejectEvent = useMutation({
    mutationFn: (id: number) => api.post(`/attendance/events/${id}/reject`),
    onSuccess: () => {
      toast.success("Event dismissed");
      refresh();
    },
    onError,
  });
  return { clockIn, clockOut, confirmEvent, rejectEvent, refresh };
}

/* ---------- month view, events, audit, corrections ---------- */

export interface MonthSummary {
  daysPresent: number;
  daysAbsent: number;
  daysLeave: number;
  lateDays: number;
  earlyLeaveDays: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
  totalLateMinutes: number;
  totalEarlyDepartureMinutes: number;
  averageWorkedMinutes: number;
}
export interface MonthResponse {
  month: string;
  days: AttendanceDayDTO[];
  summary: MonthSummary;
  schedule: { officeStart: string; officeEnd: string };
}

export const useMonthAttendance = (month: string) =>
  useQuery({ queryKey: ["attendance", "month", month], queryFn: () => api.get<MonthResponse>(`/attendance?month=${month}`) });

export const useAttendanceEvents = () =>
  useQuery({ queryKey: ["attendance", "events"], queryFn: () => api.get<{ events: AttendanceEventDTO[] }>("/attendance/events?limit=60&includeIgnored=1") });

export const useAttendanceAudit = () =>
  useQuery({ queryKey: ["attendance", "audit"], queryFn: () => api.get<{ audit: AttendanceAuditDTO[] }>("/attendance/audit?limit=150") });

export interface CorrectionBody {
  firstLoginAt?: string | null;
  lastLogoutAt?: string | null;
  status?: "leave" | "holiday" | "absent" | null;
  notes?: string;
  reason: string;
}

export function useCorrectAttendance() {
  const { refresh } = useAttendanceActions();
  return useMutation({
    mutationFn: (v: { date: string; body: CorrectionBody }) => api.put<{ attendance: AttendanceDTO }>(`/attendance/${v.date}`, v.body),
    onSuccess: () => {
      toast.success("Attendance corrected — the change is in the audit trail");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
