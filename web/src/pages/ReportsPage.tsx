import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardCopy, FileDown, FilePlus2, Link2, Lock, RefreshCw, Save, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { addDays, localDate } from "@shared/time";
import type { ReportDTO } from "@shared/types";
import { ReportStatusBadge } from "@/components/badges";
import { ReportEditor, cleanContent } from "@/components/ReportEditor";
import { ReportView } from "@/components/ReportView";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, PageLoader, Tabs } from "@/components/ui";
import { useReportActions, useReportByDate, useReportList } from "@/hooks/use-reports";
import { useSettings } from "@/hooks/use-settings";
import { api, errorMessage } from "@/lib/api";
import { dateTimeOf } from "@/lib/format";
import { buildReportPdf, copyReport, reportFileName, shareUrl } from "@/lib/report-export";
import { downloadBlob } from "@/lib/utils";
import type { ReportContent } from "@shared/types";

export function ReportsPage() {
  const today = localDate(new Date());
  const [params] = useSearchParams();
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const q = useReportByDate(date);
  const list = useReportList();
  const actions = useReportActions();

  // Reset the revision picker when the date changes.
  useEffect(() => setSelectedId(null), [date]);

  const latest = q.data?.report ?? null;
  const revisions = useMemo(() => (list.data?.reports ?? []).filter((r) => r.reportDate === date).sort((a, b) => b.revision - a.revision), [list.data, date]);
  const detail = useQuery({
    queryKey: ["report", "detail", selectedId],
    queryFn: () => api.get<{ report: ReportDTO }>(`/reports/${selectedId}`),
    enabled: selectedId !== null && selectedId !== latest?.id,
  });
  const report = selectedId !== null && selectedId !== latest?.id ? (detail.data?.report ?? null) : latest;

  return (
    <div>
      <PageHeader title="Daily Reports" description="Generate today's report from your real tasks, attendance and dev log, polish it, then submit it to your Team Lead." />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="date" className="w-auto" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Report date" />
          <Button variant="outline" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {date !== today && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
              Today
            </Button>
          )}
          {revisions.length > 1 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Versions:</span>
              {revisions.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`rounded-md border px-2 py-1 text-xs ${(report?.id ?? latest?.id) === r.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}
                >
                  Rev {r.revision} · {r.status === "draft" ? "Draft" : r.status.replace("_", " ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !report ? (
        selectedId !== null && detail.isLoading ? (
          <PageLoader />
        ) : (
          <Card>
            <EmptyState
              icon={<FilePlus2 className="h-5 w-5" />}
              title="No report for this day yet"
              description="DOM builds a draft from the tasks assigned, worked on or completed that day, your attendance, and your development log. You can edit everything before submitting."
              action={
                <Button loading={actions.generate.isPending} onClick={() => actions.generate.mutate({ date })}>
                  <FilePlus2 className="h-4 w-4" /> Generate report for this day
                </Button>
              }
            />
          </Card>
        )
      ) : (
        <ReportWorkspace key={report.id} report={report} isLatest={report.id === latest?.id} />
      )}
    </div>
  );
}

function ReportWorkspace({ report, isLatest }: { report: ReportDTO; isLatest: boolean }) {
  const { generate, save, refreshHeader, submit, revise, remove } = useReportActions();
  const settings = useSettings();
  const isDraft = report.status === "draft";
  const [content, setContent] = useState<ReportContent>(report.content);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">(isDraft ? "edit" : "preview");
  const [confirm, setConfirm] = useState<null | "submit" | "regenerate" | "delete">(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Server copy changed (regenerate, header refresh…) and there are no local edits → adopt it.
  useEffect(() => {
    if (!dirty) setContent(report.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.updatedAt, report.id]);

  const onChange = (c: ReportContent) => {
    setContent(c);
    setDirty(true);
  };

  // What the preview / copy / PDF show: the editor's current content for drafts, the stored content once locked.
  const shown: ReportDTO = useMemo(() => (isDraft ? { ...report, content: cleanContent(content) } : report), [isDraft, report, content]);

  async function saveNow(): Promise<boolean> {
    if (!isDraft) return true;
    if (!dirty) return true;
    try {
      const r = await save.mutateAsync({ id: report.id, content: cleanContent(content) });
      setContent(r.report.content);
      setDirty(false);
      return true;
    } catch {
      return false; // toast shown by the hook
    }
  }

  async function onCopy() {
    try {
      const mode = await copyReport(shown);
      toast.success(mode === "rich" ? "Copied as formatted text — paste it into Gmail, Docs or chat" : "Copied as plain text");
    } catch (e) {
      toast.error(`Couldn't copy: ${errorMessage(e)}`);
    }
  }

  async function onPdf() {
    setPdfBusy(true);
    try {
      const blob = await buildReportPdf(shown);
      downloadBlob(blob, reportFileName(report, "pdf"));
      if (settings.data?.meta.r2Enabled) {
        try {
          await api.upload(`/reports/${report.id}/pdf`, blob, "application/pdf");
          toast.success("PDF downloaded and a copy was stored in R2");
        } catch (e) {
          toast.error(`PDF downloaded, but storing the copy failed: ${errorMessage(e)}`);
        }
      } else toast.success("PDF downloaded");
    } catch (e) {
      toast.error(`Couldn't build the PDF: ${errorMessage(e)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  async function onShare() {
    try {
      await navigator.clipboard.writeText(shareUrl(report));
      toast.success("Share link copied — anyone with it can read this submitted report");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }

  const reviews = report.reviews ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <ReportStatusBadge status={report.status} />
          {report.revision > 1 && <Badge>Revision {report.revision}</Badge>}
          {!isDraft && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Locked — submitted {dateTimeOf(report.submittedAt)}
            </span>
          )}
          {isDraft && dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCopy}>
              <ClipboardCopy className="h-3.5 w-3.5" /> Copy text
            </Button>
            <Button variant="outline" size="sm" loading={pdfBusy} onClick={onPdf}>
              <FileDown className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button variant="outline" size="sm" disabled={isDraft} title={isDraft ? "Submit the report first — the link works once it's submitted" : "Copy the read-only share link"} onClick={onShare}>
              <Link2 className="h-3.5 w-3.5" /> Share link
            </Button>
            {isDraft ? (
              <>
                <Button variant="outline" size="sm" loading={save.isPending} disabled={!dirty} onClick={() => void saveNow()}>
                  <Save className="h-3.5 w-3.5" /> Save draft
                </Button>
                <Button size="sm" onClick={() => setConfirm("submit")}>
                  <Send className="h-3.5 w-3.5" /> Submit to TL
                </Button>
              </>
            ) : isLatest ? (
              <Button size="sm" loading={revise.isPending} onClick={() => revise.mutate(report.id)}>
                <Undo2 className="h-3.5 w-3.5" /> Create revision
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Older version — open the latest to revise</span>
            )}
          </div>
        </div>
        {isDraft && (
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: "edit", label: "Edit" }, { value: "preview", label: "Preview" }]} />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" loading={refreshHeader.isPending} onClick={() => refreshHeader.mutate(report.id)} title="Pull the latest attendance and profile into the header">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh attendance
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm("regenerate")} title="Rebuild the content from your current tasks, attendance and dev log">
                <RefreshCw className="h-3.5 w-3.5" /> Rebuild from data
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setConfirm("delete")}>
                <Trash2 className="h-3.5 w-3.5" /> Delete draft
              </Button>
            </div>
          </div>
        )}
      </Card>

      {isDraft && tab === "edit" ? <ReportEditor content={content} onChange={onChange} /> : <ReportView report={shown} />}

      {!isDraft && (
        <Card>
          <CardHeader title="Team Lead feedback" description={report.status === "revision_requested" ? "Your TL asked for changes — create a revision, update it and submit again." : undefined} />
          <CardBody className="space-y-2">
            {reviews.length === 0 && <p className="text-xs text-muted-foreground">No activity from your Team Lead yet.</p>}
            {reviews.map((r) => (
              <div key={r.id} className="rounded-md border px-3 py-2 text-[13px]">
                <div className="flex items-center justify-between gap-2">
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

      <ConfirmDialog
        open={confirm === "submit"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Submit this report?"
        description="Your Team Lead will see this version and it becomes locked. If something needs changing later you can create a new revision."
        confirmLabel="Submit report"
        loading={submit.isPending || save.isPending}
        onConfirm={async () => {
          if (!(await saveNow())) return;
          await submit.mutateAsync(report.id).catch(() => undefined);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "regenerate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Rebuild from your records?"
        description="This replaces everything in the draft — including your edits — with a fresh report built from your current tasks, attendance and dev log."
        confirmLabel="Rebuild"
        destructive
        loading={generate.isPending}
        onConfirm={async () => {
          const r = await generate.mutateAsync({ date: report.reportDate, regenerate: true }).catch(() => null);
          if (r) {
            setContent(r.report.content);
            setDirty(false);
          }
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="The draft is removed. You can generate a new one for this date at any time."
        confirmLabel="Delete draft"
        destructive
        loading={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(report.id).catch(() => undefined);
          setConfirm(null);
        }}
      />
    </div>
  );
}
