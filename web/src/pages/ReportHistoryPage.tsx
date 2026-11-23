import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCopy, ExternalLink, FileDown, History, Link2 } from "lucide-react";
import { toast } from "sonner";
import { REPORT_STATUSES } from "@shared/constants";
import type { ReportDTO } from "@shared/types";
import { REPORT_LABEL, ReportStatusBadge } from "@/components/badges";
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Select } from "@/components/ui";
import { useReportList } from "@/hooks/use-reports";
import { errorMessage } from "@/lib/api";
import { dateLong, dateTimeOf } from "@/lib/format";
import { buildReportPdf, copyReport, reportFileName, shareUrl } from "@/lib/report-export";
import { downloadBlob } from "@/lib/utils";

export function ReportHistoryPage() {
  const q = useReportList();
  const [status, setStatus] = useState("");
  const [month, setMonth] = useState("");
  const all = q.data?.reports ?? [];
  const months = useMemo(() => [...new Set(all.map((r) => r.reportDate.slice(0, 7)))], [all]);
  const rows = all.filter((r) => (!status || r.status === status) && (!month || r.reportDate.startsWith(month)));

  const run = (fn: () => Promise<unknown>, ok: string) => async () => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Report History"
        description="Every report and revision. Submitted versions are locked and never overwritten."
        actions={
          <>
            <Select className="w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month">
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {REPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REPORT_LABEL[s]}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <div className="p-4">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="No reports yet" description="Generate your first report from the Daily Reports page." action={<Link to="/reports"><Button>Go to Daily Reports</Button></Link>} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {["Date", "Rev", "Status", "Submitted", "Reviewed", ""].map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: ReportDTO) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-accent/40">
                    <td className="px-3 py-2 font-medium">{dateLong(r.reportDate)}</td>
                    <td className="tnum px-3">{r.revision}</td>
                    <td className="px-3">
                      <ReportStatusBadge status={r.status} />
                    </td>
                    <td className="tnum px-3 text-xs text-muted-foreground">{dateTimeOf(r.submittedAt)}</td>
                    <td className="tnum px-3 text-xs text-muted-foreground">{dateTimeOf(r.reviewedAt)}</td>
                    <td className="px-3">
                      <div className="flex justify-end gap-0.5">
                        <Link to={`/reports?date=${r.reportDate}`}>
                          <Button variant="ghost" size="icon" title="Open" aria-label="Open report">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" title="Copy as text" aria-label="Copy as text" onClick={run(() => copyReport(r), "Copied")}>
                          <ClipboardCopy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Download PDF" aria-label="Download PDF" onClick={run(async () => downloadBlob(await buildReportPdf(r), reportFileName(r, "pdf")), "PDF downloaded")}>
                          <FileDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" disabled={r.status === "draft"} title={r.status === "draft" ? "Submit first" : "Copy share link"} aria-label="Copy share link" onClick={run(() => navigator.clipboard.writeText(shareUrl(r)), "Share link copied")}>
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
