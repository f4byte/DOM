import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from "@shared/constants";
import { localDate, localDateTimeToUtcIso } from "@shared/time";
import type { TaskDTO } from "@shared/types";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { parseDuration } from "@/lib/utils";

/** Global "Quick add task" dialog (opened from the top bar or by pressing N). */
export function QuickAddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const blank = () => ({ title: "", category: "Other", priority: "Medium", status: "Not Started", assignedDate: localDate(new Date()), deadline: "", estimate: "" });
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const est = parseDuration(f.estimate);
      if (Number.isNaN(est)) throw new Error('Estimated duration: use e.g. "90", "1h 30m" or "2h"');
      return api.post<{ task: TaskDTO }>("/tasks", {
        title: f.title,
        category: f.category,
        priority: f.priority,
        status: f.status,
        assignedDate: f.assignedDate,
        deadline: f.deadline ? localDateTimeToUtcIso(f.deadline) : null,
        estimatedMinutes: est,
      });
    },
    onSuccess: (r) => {
      toast.success(`${r.task.code} added`);
      for (const k of ["tasks", "dashboard", "analytics"]) void qc.invalidateQueries({ queryKey: [k] });
      setF(blank());
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Quick add task"
      description="Add the essentials now — open the task later to fill in notes, blockers and more."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!f.title.trim()} onClick={() => create.mutate()}>
            Add task
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.title.trim()) create.mutate();
        }}
      >
        <Field label="Title" className="col-span-2">
          <Input autoFocus value={f.title} onChange={set("title")} placeholder="e.g. Build the attendance table" maxLength={200} />
        </Field>
        <Field label="Category">
          <Select value={f.category} onChange={set("category")}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={set("priority")}>
            {TASK_PRIORITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {TASK_STATUSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned date">
          <Input type="date" value={f.assignedDate} onChange={set("assignedDate")} />
        </Field>
        <Field label="Deadline (Asia/Dhaka)">
          <Input type="datetime-local" value={f.deadline} onChange={set("deadline")} />
        </Field>
        <Field label="Estimated duration" hint='e.g. "90", "1h 30m"'>
          <Input value={f.estimate} onChange={set("estimate")} placeholder="1h 30m" />
        </Field>
        {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
