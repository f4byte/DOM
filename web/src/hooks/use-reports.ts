import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReportContent, ReportDTO } from "@shared/types";
import { api, errorMessage } from "@/lib/api";

export const useReportByDate = (date: string) =>
  useQuery({ queryKey: ["report", "by-date", date], queryFn: () => api.get<{ report: ReportDTO | null }>(`/reports/by-date/${date}`) });

export const useReportList = () => useQuery({ queryKey: ["report", "list"], queryFn: () => api.get<{ reports: ReportDTO[] }>("/reports") });

/** Mutations for the report lifecycle. Each refreshes every report view and the dashboard's report card. */
export function useReportActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["report", "dashboard", "analytics"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const generate = useMutation({
    mutationFn: (v: { date: string; regenerate?: boolean }) => api.post<{ report: ReportDTO; created: boolean }>("/reports/generate", v),
    onSuccess: (r, v) => {
      toast.success(v.regenerate ? "Report rebuilt from your latest tasks, attendance and dev log" : r.created ? "Draft created from your records" : "Opened existing draft");
      refresh();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (v: { id: number; content: ReportContent }) => api.put<{ report: ReportDTO }>(`/reports/${v.id}`, { content: v.content }),
    onSuccess: refresh,
    onError,
  });
  const refreshHeader = useMutation({
    mutationFn: (id: number) => api.post<{ report: ReportDTO }>(`/reports/${id}/refresh-header`),
    onSuccess: () => {
      toast.success("Attendance details refreshed");
      refresh();
    },
    onError,
  });
  const submit = useMutation({
    mutationFn: (id: number) => api.post<{ report: ReportDTO }>(`/reports/${id}/submit`),
    onSuccess: () => {
      toast.success("Report submitted to your Team Lead — this version is now locked");
      refresh();
    },
    onError,
  });
  const revise = useMutation({
    mutationFn: (id: number) => api.post<{ report: ReportDTO; created: boolean }>(`/reports/${id}/revise`),
    onSuccess: (r) => {
      toast.success(`Revision ${r.report.revision} created — you can edit it now`);
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/reports/${id}`),
    onSuccess: () => {
      toast.success("Draft deleted");
      refresh();
    },
    onError,
  });
  return { generate, save, refreshHeader, submit, revise, remove };
}
