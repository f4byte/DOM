import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import type { PublicReportDTO } from "@shared/types";
import { Logo } from "@/components/AppLayout";
import { ReportView } from "@/components/ReportView";
import { Button, Card, CardBody, CardHeader, ErrorState, PageLoader } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { dateTimeOf } from "@/lib/format";
import { buildReportPdf, reportFileName } from "@/lib/report-export";
import { downloadBlob } from "@/lib/utils";

/** Public, read-only view of a submitted report, reached through its secret link. No sign-in needed. */
export function PublicReportPage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["public-report", token],
    queryFn: () => api.get<PublicReportDTO>(`/public/reports/${token}`),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex h-14 items-center gap-2.5 border-b bg-background px-4 md:px-6">
        <Logo />
        <div className="leading-tight">
          <div className="text-sm font-semibold">DOM</div>
          <div className="text-[11px] text-muted-foreground">Shared daily report · read-only</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl p-4 md:p-6">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          q.error instanceof ApiError && q.error.status === 404 ? (
            <Card>
              <CardBody className="py-10 text-center">
                <p className="font-medium">This report isn't available</p>
                <p className="mt-1 text-xs text-muted-foreground">The link is wrong, or the report hasn't been submitted yet.</p>
              </CardBody>
            </Card>
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )
        ) : (
          q.data && <Loaded data={q.data} />
        )}
      </main>
    </div>
  );
}

function Loaded({ data }: { data: PublicReportDTO }) {
  const { report, reviews, latest } = data;
  const newer = latest && latest.revision > report.revision;
  return (
    <div className="space-y-4">
      {newer && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
          A newer revision of this report exists.{" "}
          <Link className="font-medium underline" to={`/r/${latest!.token}`} reloadDocument>
            View Revision {latest!.revision}
          </Link>
        </div>
      )}
      <div className="flex justify-end">
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
      <ReportView report={report} />
      {reviews.length > 0 && (
        <Card>
          <CardHeader title="Team Lead feedback" />
          <CardBody className="space-y-2">
            {reviews
              .filter((r) => r.action !== "viewed")
              .map((r) => (
                <div key={r.id} className="rounded-md border px-3 py-2 text-[13px]">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {r.reviewerName} · {r.action.replace("_", " ")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{dateTimeOf(r.createdAt)}</span>
                  </div>
                  {r.comment && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.comment}</p>}
                </div>
              ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
