import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TaskActivityDTO, TaskDTO } from "@shared/types";
import { api, errorMessage, qs } from "@/lib/api";

export interface TaskFilters {
  q?: string;
  status?: string;
  category?: string;
  priority?: string;
  from?: string;
  to?: string;
  overdue?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
}

export type TaskPatch = Partial<
  Pick<
    TaskDTO,
    | "title"
    | "description"
    | "category"
    | "assignedDate"
    | "startTime"
    | "deadline"
    | "priority"
    | "status"
    | "estimatedMinutes"
    | "actualMinutes"
    | "progressPercent"
    | "implementationNotes"
    | "blockers"
    | "completedAt"
    | "referenceUrl"
  >
>;

export const useTasks = (f: TaskFilters) =>
  useQuery({
    queryKey: ["tasks", "list", f],
    queryFn: () => api.get<{ tasks: TaskDTO[]; total: number }>(`/tasks${qs({ ...f, overdue: f.overdue ? 1 : undefined })}`),
    placeholderData: keepPreviousData,
  });

export const useTask = (id: number | null) =>
  useQuery({
    queryKey: ["tasks", "detail", id],
    queryFn: () => api.get<{ task: TaskDTO; activity: TaskActivityDTO[] }>(`/tasks/${id}`),
    enabled: id !== null,
  });

/** Every mutation refreshes everything that displays tasks (grid, dashboard, analytics, reports). */
export function useTaskActions() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const k of ["tasks", "dashboard", "analytics", "report"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const create = useMutation({
    mutationFn: (body: TaskPatch & { title: string }) => api.post<{ task: TaskDTO }>("/tasks", body),
    onSuccess: (r) => {
      toast.success(`${r.task.code} added`);
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: (v: { id: number; patch: TaskPatch }) => api.patch<{ task: TaskDTO }>(`/tasks/${v.id}`, v.patch),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/tasks/${id}`),
    onSuccess: () => {
      toast.success("Task deleted");
      refresh();
    },
    onError,
  });
  const duplicate = useMutation({
    mutationFn: (id: number) => api.post<{ task: TaskDTO }>(`/tasks/${id}/duplicate`),
    onSuccess: (r) => {
      toast.success(`Duplicated as ${r.task.code}`);
      refresh();
    },
    onError,
  });
  return { create, update, remove, duplicate, refresh };
}
