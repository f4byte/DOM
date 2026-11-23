import { useEffect, useState } from "react";
import { Bot, Check, ChevronLeft, ChevronRight, Clock, LogIn, LogOut, Pencil, Smartphone, X } from "lucide-react";
import { localDateTimeToUtcIso, utcIsoToLocalDateTime, addDays, formatDuration, to12h } from "@shared/time";
import type { AttendanceDayDTO, AttendanceEventDTO } from "@shared/types";
import { AttendanceBadge, SourceBadge } from "@/components/badges";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Progress, Select, StatCard, Tabs, Textarea } from "@/components/ui";
import {
  useAttendanceActions,
  useAttendanceAudit,
  useAttendanceEvents,
  useCorrectAttendance,
  useMonthAttendance,
  useTodayAttendance,
  type CorrectionBody,
} from "@/hooks/use-attendance";
import { useNow } from "@/hooks/use-now";
import { dateLong, dateTimeOf, hoursText, timeOf, weekdayShort } from "@/lib/format";
import { localDate } from "@shared/time";
import { cn } from "@/lib/utils";

const monthOf = (d: string) => d.slice(0, 7);
function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

export function AttendancePage() {
  const today = localDate(new Date());
  const [month, setMonth] = useState(monthOf(today));
  const [tab, setTab] = useState<"month" | "events" | "audit">("month");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const todayQ = useTodayAttendance();
  const monthQ = useMonthAttendance(month);

  return (
    <div>
      <PageHeader title="Attendance" description="Office hours are counted from your first login to your last logout. Everything is stored in Asia/Dhaka time." />

      {todayQ.isLoading ? <PageLoader /> : todayQ.isError ? <ErrorState error={todayQ.error} onRetry={() => todayQ.refetch()} /> : todayQ.data && <TodayCard data={todayQ.data} onCorrect={() => setCorrecting(todayQ.data.date)} />}

      <PendingEvents />

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "month", label: "Monthly log" }, { value: "events", label: "Device events" }, { value: "audit", label: "Audit trail" }]} />
        {tab === "month" && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[130px] text-center text-[13px] font-medium">{monthLabel(month)}</div>
            <Button variant="outline" size="icon" aria-label="Next month" disabled={month >= monthOf(today)} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {tab === "month" && (monthQ.isLoading ? <PageLoader /> : monthQ.isError ? <ErrorState error={monthQ.error} onRetry={() => monthQ.refetch()} /> : monthQ.data && <MonthView data={monthQ.data} onCorrect={setCorrecting} />)}
      {tab === "events" && <EventsTab />}
      {tab === "audit" && <AuditTab />}

      <CorrectionDialog date={correcting} onClose={() => setCorrecting(null)} />
    </div>
  );
}

/* ---------- today ---------- */

function TodayCard({ data, onCorrect }: { data: NonNullable<ReturnType<typeof useTodayAttendance>["data"]>; onCorrect: () => void }) {
  const { clockIn, clockOut } = useAttendanceActions();
  useNow(30_000); // keep the "now"-dependent labels fresh between server refetches
  const a = data.attendance;
  const started = !!a.firstLoginAt;
  const pct = a.standardMinutes ? Math.min(100, Math.round((a.workedMinutes / a.standardMinutes) * 100)) : 0;
  return (
    <Card>
      <CardHeader
        title={`Today · ${dateLong(data.date)}`}
        description={`Office hours ${to12h(data.schedule.officeStart)} – ${to12h(data.schedule.officeEnd)}`}
        actions={
          <>
            <AttendanceBadge status={a.status} />
            <Button variant="ghost" size="sm" onClick={onCorrect}>
              <Pencil className="h-3.5 w-3.5" /> Correct
            </Button>
          </>
        }
      />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Login" value={timeOf(a.firstLoginAt)} extra={<SourceBadge source={a.loginSource} />} sub={a.lateMinutes > 0 ? `${formatDuration(a.lateMinutes)} late` : a.earlyArrivalMinutes > 0 ? `${formatDuration(a.earlyArrivalMinutes)} early` : started ? "On time" : undefined} />
          <Metric label="Logout" value={timeOf(a.lastLogoutAt)} extra={<SourceBadge source={a.logoutSource} />} sub={a.earlyDepartureMinutes > 0 ? `${formatDuration(a.earlyDepartureMinutes)} early` : undefined} />
          <Metric label="Worked" value={started ? formatDuration(a.workedMinutes) : "—"} sub={started ? `of ${formatDuration(a.standardMinutes)} standard` : undefined} />
          <Metric
            label={a.overtimeMinutes > 0 ? "Overtime" : "Remaining"}
            value={!started ? "—" : a.overtimeMinutes > 0 ? formatDuration(a.overtimeMinutes) : formatDuration(a.remainingMinutes)}
            sub={a.shortfallMinutes > 0 ? `${formatDuration(a.shortfallMinutes)} short` : undefined}
          />
        </div>
        {started && <Progress value={pct} className="mt-4" />}
        <div className="mt-4 flex flex-wrap gap-2">
          {!started ? (
            <Button variant="success" loading={clockIn.isPending} onClick={() => clockIn.mutate()}>
              <LogIn className="h-4 w-4" /> Clock in now
            </Button>
          ) : (
            <Button variant="outline" loading={clockOut.isPending} onClick={() => clockOut.mutate()}>
              <LogOut className="h-4 w-4" /> {a.lastLogoutAt ? "Update clock-out to now" : "Clock out now"}
            </Button>
          )}
          <p className="self-center text-xs text-muted-foreground">Manual clock-in/out always records the current server time. To fix a past time use “Correct” (a reason is required).</p>
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value, sub, extra }: { label: string; value: React.ReactNode; sub?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tnum mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        {value} {extra}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ---------- pending device events ---------- */

function PendingEvents() {
  const { data } = useTodayAttendance();
  const { confirmEvent, rejectEvent } = useAttendanceActions();
  const events = data?.pendingEvents ?? [];
  if (events.length === 0) return null;
  return (
    <Card className="mt-4 border-amber-500/40">
      <CardHeader title="Device events waiting for your confirmation" description="Your phone reported these. Nothing changes in attendance until you confirm." />
      <div className="divide-y">
        {events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Smartphone className="h-4 w-4 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                Phone {e.eventType === "unlock" ? "unlocked" : "locked"} at {timeOf(e.occurredAt)} · {dateTimeOf(e.occurredAt).split(",")[0]}
              </p>
              <p className="text-xs text-muted-foreground">
                Suggested: <b>{e.suggestedAction === "login" ? "record login" : "record logout"}</b>
                {e.deviceLabel ? ` · ${e.deviceLabel}` : ""}
              </p>
            </div>
            <Button size="sm" variant="success" loading={confirmEvent.isPending && confirmEvent.variables?.id === e.id} onClick={() => confirmEvent.mutate({ id: e.id })}>
              <Check className="h-3.5 w-3.5" /> Confirm {e.suggestedAction ?? ""}
            </Button>
            <Button size="sm" variant="outline" loading={rejectEvent.isPending && rejectEvent.variables === e.id} onClick={() => rejectEvent.mutate(e.id)}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- month ---------- */

function MonthView({ data, onCorrect }: { data: NonNullable<ReturnType<typeof useMonthAttendance>["data"]>; onCorrect: (d: string) => void }) {
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Days present" value={s.daysPresent} sub={`${s.daysAbsent} absent · ${s.daysLeave} leave`} />
        <StatCard label="Total worked" value={hoursText(s.totalWorkedMinutes)} sub={`avg ${hoursText(s.averageWorkedMinutes)} / day`} />
        <StatCard label="Overtime" value={formatDuration(s.totalOvertimeMinutes)} tone="blue" />
        <StatCard label="Late arrivals" value={s.lateDays} sub={`${formatDuration(s.totalLateMinutes)} total`} tone={s.lateDays ? "amber" : undefined} />
        <StatCard label="Early departures" value={s.earlyLeaveDays} sub={`${formatDuration(s.totalEarlyDepartureMinutes)} total`} tone={s.earlyLeaveDays ? "amber" : undefined} />
      </div>
      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-b bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {["Date", "Login", "Logout", "Worked", "Late", "Early out", "Overtime", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().map((d) => (
                <DayRow key={d.date} d={d} onCorrect={onCorrect} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const PLACEHOLDER_LABEL: Record<string, string> = { weekend: "Weekend", future: "", before_start: "Before you joined", absent: "No record" };

function DayRow({ d, onCorrect }: { d: AttendanceDayDTO; onCorrect: (d: string) => void }) {
  const r = d.record;
  const muted = !r && d.placeholder !== "absent";
  const [, mm, dd] = d.date.split("-");
  return (
    <tr className={cn("border-b last:border-b-0", muted && "text-muted-foreground", d.placeholder === "absent" && "bg-red-500/[0.05]")}>
      <td className="whitespace-nowrap px-3 py-2 font-medium">
        {dd}/{mm} <span className="font-normal text-muted-foreground">{weekdayShort(d.date)}</span>
      </td>
      {r ? (
        <>
          <td className="tnum px-3">
            {timeOf(r.firstLoginAt)} <SourceBadge source={r.loginSource} />
          </td>
          <td className="tnum px-3">
            {timeOf(r.lastLogoutAt)} <SourceBadge source={r.logoutSource} />
          </td>
          <td className="tnum px-3">{r.firstLoginAt ? formatDuration(r.workedMinutes) : "—"}</td>
          <td className={cn("tnum px-3", r.lateMinutes > 0 && "text-amber-600 dark:text-amber-400")}>{r.lateMinutes > 0 ? formatDuration(r.lateMinutes) : "—"}</td>
          <td className={cn("tnum px-3", r.earlyDepartureMinutes > 0 && "text-amber-600 dark:text-amber-400")}>{r.earlyDepartureMinutes > 0 ? formatDuration(r.earlyDepartureMinutes) : "—"}</td>
          <td className="tnum px-3">{r.overtimeMinutes > 0 ? formatDuration(r.overtimeMinutes) : "—"}</td>
          <td className="px-3">
            <AttendanceBadge status={r.status} />
            {r.notes && (
              <span className="ml-1.5 text-xs text-muted-foreground" title={r.notes}>
                note
              </span>
            )}
          </td>
        </>
      ) : (
        <>
          <td colSpan={6} className="px-3 text-xs">
            {PLACEHOLDER_LABEL[d.placeholder ?? ""] ?? ""}
          </td>
          <td className="px-3">{d.placeholder === "absent" && <AttendanceBadge status="absent" />}</td>
        </>
      )}
      <td className="px-3 text-right">
        {d.placeholder !== "future" && d.placeholder !== "before_start" && (
          <Button variant="ghost" size="icon" aria-label={`Correct ${d.date}`} title="Correct this day" onClick={() => onCorrect(d.date)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}

/* ---------- events + audit ---------- */

const EVENT_STATUS_TONE = { pending: "amber", confirmed: "green", rejected: "gray", ignored: "gray", superseded: "gray" } as const;
const EVENT_LABEL: Record<AttendanceEventDTO["eventType"], string> = { unlock: "Phone unlocked", lock: "Phone locked", login: "Manual clock-in", logout: "Manual clock-out" };

function EventsTab() {
  const q = useAttendanceEvents();
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const events = q.data?.events ?? [];
  return (
    <Card>
      {events.length === 0 ? (
        <EmptyState icon={<Smartphone className="h-5 w-5" />} title="No device events yet" description="Set up the Android automation in Settings → Automation, and unlock/lock events will show up here." />
      ) : (
        <div className="divide-y">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-muted">{e.source === "automatic" ? <Bot className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{EVENT_LABEL[e.eventType]}</p>
                <p className="text-xs text-muted-foreground">
                  {dateTimeOf(e.occurredAt)}
                  {e.deviceLabel ? ` · ${e.deviceLabel}` : ""}
                  {e.ignoreReason ? ` · ${e.ignoreReason}` : ""}
                </p>
              </div>
              {e.suggestedAction && <span className="text-xs text-muted-foreground">suggested {e.suggestedAction}</span>}
              <Badge tone={EVENT_STATUS_TONE[e.status]}>{e.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AuditTab() {
  const q = useAttendanceAudit();
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data?.audit ?? [];
  const fmt = (field: string | null, v: string | null) => (v == null ? "—" : field === "first_login_at" || field === "last_logout_at" ? dateTimeOf(v) : v);
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState icon={<Clock className="h-5 w-5" />} title="No changes recorded yet" description="Every clock-in, clock-out, device confirmation and manual correction is logged here." />
      ) : (
        <div className="divide-y">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {dateLong(r.workDate)} · {r.action.replace(/_/g, " ")}
                  {r.field ? ` · ${r.field.replace(/_/g, " ")}` : ""}
                </p>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SourceBadge source={r.source} /> {dateTimeOf(r.createdAt)}
                </span>
              </div>
              {r.field && (
                <p className="text-xs text-muted-foreground">
                  {fmt(r.field, r.oldValue)} → <span className="text-foreground">{fmt(r.field, r.newValue)}</span>
                </p>
              )}
              {r.reason && <p className="mt-0.5 text-xs italic text-muted-foreground">Reason: {r.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------- correction dialog ---------- */

function CorrectionDialog({ date, onClose }: { date: string | null; onClose: () => void }) {
  const month = date ? monthOf(date) : monthOf(localDate(new Date()));
  const monthQ = useMonthAttendance(month);
  const todayQ = useTodayAttendance();
  const correct = useCorrectAttendance();
  const record = date ? (monthQ.data?.days.find((d) => d.date === date)?.record ?? (todayQ.data?.date === date ? todayQ.data.attendance : null)) : null;

  const blank = { login: "", logout: "", status: "", notes: "", reason: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const loaded = !!date && (!monthQ.isLoading || todayQ.data?.date === date);

  useEffect(() => {
    if (!date || !loaded) return;
    setF({
      login: record?.firstLoginAt ? utcIsoToLocalDateTime(record.firstLoginAt) : "",
      logout: record?.lastLogoutAt ? utcIsoToLocalDateTime(record.lastLogoutAt) : "",
      status: record?.statusManual && ["leave", "holiday", "absent"].includes(record.status) ? record.status : "",
      notes: record?.notes ?? "",
      reason: "",
    });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loaded, record?.id, record?.firstLoginAt, record?.lastLogoutAt]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit() {
    if (!date) return;
    setError(null);
    const body: CorrectionBody = { reason: f.reason.trim() };
    const origLogin = record?.firstLoginAt ? utcIsoToLocalDateTime(record.firstLoginAt) : "";
    const origLogout = record?.lastLogoutAt ? utcIsoToLocalDateTime(record.lastLogoutAt) : "";
    const origStatus = record?.statusManual ? record.status : "";
    if (f.login !== origLogin) body.firstLoginAt = f.login ? localDateTimeToUtcIso(f.login) : null;
    if (f.logout !== origLogout) body.lastLogoutAt = f.logout ? localDateTimeToUtcIso(f.logout) : null;
    if (f.status !== origStatus) body.status = (f.status || null) as CorrectionBody["status"];
    if (f.notes !== (record?.notes ?? "")) body.notes = f.notes;
    if (Object.keys(body).length === 1) return setError("Change at least one field.");
    if (body.reason.length < 3) return setError("Please explain why you are changing this (a reason is required).");
    if (f.login && f.logout && f.logout < f.login) return setError("Logout can't be earlier than login.");
    try {
      await correct.mutateAsync({ date, body });
      onClose();
    } catch {
      /* toast shown by the hook */
    }
  }

  return (
    <Modal
      open={!!date}
      onOpenChange={(o) => !o && onClose()}
      title={date ? `Correct attendance · ${dateLong(date)}` : "Correct attendance"}
      description="Corrections are saved with your reason and kept in the audit trail. Times are Asia/Dhaka."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={correct.isPending} onClick={submit}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First login">
          <Input type="datetime-local" value={f.login} onChange={set("login")} />
        </Field>
        <Field label="Last logout">
          <Input type="datetime-local" value={f.logout} onChange={set("logout")} />
        </Field>
        <Field label="Day status" className="col-span-2" hint="Leave this on “Automatic” unless the day was leave, a holiday or an absence.">
          <Select value={f.status} onChange={set("status")}>
            <option value="">Automatic (from login/logout)</option>
            <option value="leave">Leave</option>
            <option value="holiday">Holiday</option>
            <option value="absent">Absent</option>
          </Select>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea rows={2} value={f.notes} onChange={set("notes")} maxLength={1000} />
        </Field>
        <Field label="Reason for correction (required)" className="col-span-2">
          <Input value={f.reason} onChange={set("reason")} maxLength={500} placeholder="e.g. Forgot to clock in; arrived 10:05 per door log" />
        </Field>
        {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
