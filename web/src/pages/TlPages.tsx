import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileDown, LogOut, MessageSquare, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { REPORT_STATUSES, type ReviewAction } from "@shared/constants";
import type { ReportDTO, ReviewDTO } from "@shared/types";
import { Logo } from "@/components/AppLayout";
import { ReportStatusBadge, REPORT_LABEL } from "@/components/badges";
import { ReportView } from "@/components/ReportView";
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, PageHeader, PageLoader, Select, Textarea } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { api, errorMessage } from "@/lib/api";
import { dateLong, dateTimeOf } from "@/lib/format";
import { buildReportPdf, reportFileName } from "@/lib/report-export";
import { downloadBlob } from "@/lib/utils";

/** Read-only shell for Team Leads: no tasks, attendance editing or settings — just submitted reports. */
export function TlLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
        <Link to="/tl" className="flex items-center gap-2.5">
          <Logo />
          <div className="leading-tight">
            <div className="text-sm font-semibold">DOM</div>
            <div className="text-[11px] text-muted-foreground">Team Lead view</div>
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="hidden text-muted-foreground sm:inline">{user?.fullName}</span>
          <Button variant="ghost" size="sm" onClick={() => setTheme(next)}>
            Theme: {theme}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function TlReportsPage() {
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["tl", "reports", status], queryFn: () => api.get<{ reports: ReportDTO[] }>(`/tl/reports${status ? `?status=${status}` : ""}`) });
  const reports = q.data?.reports ?? [];
  return (
    <div>
      <PageHeader
        title="Submitted reports"
        description="Daily reports from the interns you mentor. Opening a report marks it as viewed."
        actions={
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {REPORT_STATUSES.filter((s) => s !== "draft").map((s) => (
              <option key={s} value={s}>
                {REPORT_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <div className="p-4">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : reports.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No submitted reports" description="Reports appear here once an intern submits them." />
        ) : (
          <div className="divide-y">
            {reports.map((r) => (
              <Link key={r.id} to={`/tl/reports/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">
                    {r.internName ?? r.header.employeeName} · {dateLong(r.reportDate)}
                    {r.revision > 1 && <span className="ml-2 text-xs font-normal text-muted-foreground">Revision {r.revision}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">Submitted {dateTimeOf(r.submittedAt)}</p>
                </div>
                <ReportStatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const ACTIONS: { action: ReviewAction; label: string; icon: React.ReactNode; variant: "outline" | "default" | "success" | "destructive"; needsComment: boolean }[] = [
  { action: "comment", label: "Add comment", icon: <MessageSquare className="h-3.5 w-3.5" />, variant: "outline", needsComment: true },
  { action: "reviewed", label: "Mark reviewed", icon: <ClipboardCheck className="h-3.5 w-3.5" />, variant: "default", needsComment: false },
  { action: "revision_requested", label: "Request revision", icon: <RotateCcw className="h-3.5 w-3.5" />, variant: "outline", needsComment: true },
  { action: "approved", label: "Approve", icon: <CheckCircle2 className="h-3.5 w-3.5" />, variant: "success", needsComment: false },
];

export function TlReportPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const q = useQuery({
    queryKey: ["tl", "report", id],
    queryFn: () => api.get<{ report: ReportDTO; latest: { revision: number; token: string; status: string } | null }>(`/tl/reports/${id}`),
    // Opening marks the report as viewed on the server; don't refetch on every window focus (it would be a no-op but noisy).
    refetchOnWindowFocus: false,
  });

  const review = useMutation({
    mutationFn: (action: ReviewAction) => api.post<{ report: ReportDTO }>(`/tl/reports/${id}/review`, { action, comment: comment.trim() }),
    onSuccess: (r) => {
      toast.success(`Marked as ${REPORT_LABEL[r.report.status].toLowerCase()}`);
      setComment("");
      void qc.invalidateQueries({ queryKey: ["tl"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { report, latest } = q.data;
  const superseded = !!latest && latest.revision > report.revision;
  const reviews: ReviewDTO[] = report.reviews ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => nav("/tl")}>
          <ArrowLeft className="h-3.5 w-3.5" /> All reports
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              downloadBlob(await buildReportPdf(report), reportFileName(report, "pdf"));
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        >
          <FileDown className="h-3.5 w-3.5" /> Download PDF
        </Button>
      </div>

      {superseded && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
          A newer revision (Revision {latest!.revision}) has been submitted. Reviews on this older version are disabled.
        </div>
      )}

      <ReportView report={report} />

      <Card className="mt-4">
        <CardHeader title="Review" description="Your action and comment are visible to the intern." />
        <CardBody className="space-y-3">
          <Field label="Comment">
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={3000} placeholder="Feedback for the intern (required for comments and revision requests)" disabled={superseded} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <Button
                key={a.action}
                variant={a.variant}
                size="sm"
                disabled={superseded || (a.needsComment && !comment.trim())}
                loading={review.isPending && review.variables === a.action}
                onClick={() => review.mutate(a.action)}
              >
                {a.icon} {a.label}
              </Button>
            ))}
          </div>
          {reviews.length > 0 && (
            <ul className="space-y-2 border-t pt-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-md border px-3 py-2 text-[13px]">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {r.reviewerName} · {r.action.replace("_", " ")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{dateTimeOf(r.createdAt)}</span>
                  </div>
                  {r.comment && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
