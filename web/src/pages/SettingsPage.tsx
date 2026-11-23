import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Plus, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { UserSettings } from "@shared/constants";
import type { SettingsResponse } from "@shared/types";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Switch, Tabs } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/hooks/use-theme";
import { api, errorMessage } from "@/lib/api";
import { dateTimeOf, WEEKDAYS } from "@/lib/format";
import { cn, downloadBlob } from "@/lib/utils";
import { localDate } from "@shared/time";

type Tab = "general" | "automation" | "tl" | "security";

export function SettingsPage() {
  const q = useSettings();
  const [tab, setTab] = useState<Tab>("general");
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <div>
      <PageHeader title="Settings" description="Everything here is stored in your database and applies to attendance maths, automation and reports." />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "general", label: "Profile & schedule" },
            { value: "automation", label: "Automation" },
            { value: "tl", label: "Team Lead" },
            { value: "security", label: "Security & data" },
          ]}
        />
      </div>
      {tab === "general" && <General s={s} />}
      {tab === "automation" && <Automation s={s} />}
      {tab === "tl" && <TeamLead s={s} />}
      {tab === "security" && <Security s={s} />}
    </div>
  );
}

/** Save helper: PUT /settings with a partial body, then refresh everything that depends on settings. */
function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { profile?: Partial<SettingsResponse["profile"]>; settings?: Partial<UserSettings> }) => api.put<SettingsResponse>("/settings", body),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      for (const k of ["attendance", "dashboard", "analytics", "report"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/* ------------------------------------------------------------------ general */

function General({ s }: { s: SettingsResponse }) {
  const save = useSaveSettings();
  const { theme, setTheme } = useTheme();
  const [p, setP] = useState({ fullName: s.profile.fullName, mentorName: s.profile.mentorName, employmentType: s.profile.employmentType });
  const [c, setC] = useState({ officeStart: s.settings.officeStart, officeEnd: s.settings.officeEnd, unpaidBreakMinutes: String(s.settings.unpaidBreakMinutes), graceMinutes: String(s.settings.graceMinutes), countEarly: s.settings.countEarlyArrivalAsOvertime, days: s.settings.workingDays });
  const [err, setErr] = useState<string | null>(null);

  const saveProfile = () => save.mutate({ profile: { fullName: p.fullName.trim(), mentorName: p.mentorName.trim(), employmentType: p.employmentType.trim() } });
  const saveSchedule = () => {
    setErr(null);
    const brk = Number(c.unpaidBreakMinutes);
    const grace = Number(c.graceMinutes);
    if (!Number.isInteger(brk) || brk < 0 || brk > 240) return setErr("Unpaid break must be 0–240 minutes");
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) return setErr("Grace period must be 0–120 minutes");
    if (c.officeEnd <= c.officeStart) return setErr("Office end must be after office start");
    if (c.days.length === 0) return setErr("Pick at least one working day");
    save.mutate({ settings: { officeStart: c.officeStart, officeEnd: c.officeEnd, unpaidBreakMinutes: brk, graceMinutes: grace, countEarlyArrivalAsOvertime: c.countEarly, workingDays: c.days } });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" />
        <CardBody className="space-y-3">
          <Field label="Full name">
            <Input value={p.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Email" hint="Used to sign in. Can't be changed here.">
            <Input value={s.profile.email} disabled />
          </Field>
          <Field label="Role / employment type">
            <Input value={p.employmentType} onChange={(e) => setP({ ...p, employmentType: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Mentor / Team Lead name" hint="Shown on your reports.">
            <Input value={p.mentorName} onChange={(e) => setP({ ...p, mentorName: e.target.value })} maxLength={120} />
          </Field>
          <Button loading={save.isPending} disabled={!p.fullName.trim()} onClick={saveProfile}>
            Save profile
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Office schedule" description={`Timezone: ${s.meta.timezone} (UTC+6). Attendance is calculated against these hours.`} />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Office start">
              <Input type="time" value={c.officeStart} onChange={(e) => setC({ ...c, officeStart: e.target.value })} />
            </Field>
            <Field label="Office end">
              <Input type="time" value={c.officeEnd} onChange={(e) => setC({ ...c, officeEnd: e.target.value })} />
            </Field>
            <Field label="Unpaid break (min)" hint="Deducted from worked time">
              <Input type="number" min={0} max={240} value={c.unpaidBreakMinutes} onChange={(e) => setC({ ...c, unpaidBreakMinutes: e.target.value })} />
            </Field>
            <Field label="Late grace (min)" hint="Arrival within this isn't late">
              <Input type="number" min={0} max={120} value={c.graceMinutes} onChange={(e) => setC({ ...c, graceMinutes: e.target.value })} />
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Working days</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w, i) => {
                const on = c.days.includes(i);
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setC({ ...c, days: on ? c.days.filter((d) => d !== i) : [...c.days, i].sort() })}
                    className={cn("h-8 w-12 rounded-md border text-[13px] font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent")}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </div>
          <Switch checked={c.countEarly} onChange={(v) => setC({ ...c, countEarly: v })} label="Count early arrival as overtime" description="Off by default: time before office start is never double-counted as overtime." />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <Button loading={save.isPending} onClick={saveSchedule}>
            Save schedule
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Appearance" />
        <CardBody>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button key={t} variant={theme === t ? "default" : "outline"} size="sm" onClick={() => setTheme(t)} className="capitalize">
                {t}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Remembered on this device only.</p>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ automation */

function Automation({ s }: { s: SettingsResponse }) {
  const save = useSaveSettings();
  const qc = useQueryClient();
  const [a, setA] = useState({ ...s.settings });
  useEffect(() => setA({ ...s.settings }), [s.settings]);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<{ label: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const createToken = useMutation({
    mutationFn: () => api.post<{ id: number; label: string; token: string }>("/device/tokens", { label: label.trim() }),
    onSuccess: (r) => {
      setCreated({ label: r.label, token: r.token });
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/device/tokens/${id}`),
    onSuccess: () => {
      toast.success("Token revoked — the phone can no longer send events");
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const endpoint = `${window.location.origin}/api/device/event`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  const dirty = JSON.stringify(a) !== JSON.stringify(s.settings);
  const saveAuto = () => {
    if (a.loginWindowEnd <= a.loginWindowStart) return toast.error("Login window end must be after its start");
    save.mutate({
      settings: { automationEnabled: a.automationEnabled, autoConfirmDeviceEvents: a.autoConfirmDeviceEvents, loginWindowStart: a.loginWindowStart, loginWindowEnd: a.loginWindowEnd, logoutSuggestAfter: a.logoutSuggestAfter },
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Phone unlock / lock automation" description="Your phone tells DOM when it is unlocked or locked. DOM only suggests a login or logout — you confirm it." />
        <CardBody className="space-y-4">
          <Switch checked={a.automationEnabled} onChange={(v) => setA({ ...a, automationEnabled: v })} label="Accept events from my phone" description="When off, the webhook still answers but every event is ignored." />
          <Switch checked={a.autoConfirmDeviceEvents} onChange={(v) => setA({ ...a, autoConfirmDeviceEvents: v })} label="Auto-confirm suggestions" description="Skip the confirmation step. Leave off if you sometimes unlock your phone away from the office." />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Login window starts" hint="Earliest unlock that suggests a login">
              <Input type="time" value={a.loginWindowStart} onChange={(e) => setA({ ...a, loginWindowStart: e.target.value })} />
            </Field>
            <Field label="Login window ends">
              <Input type="time" value={a.loginWindowEnd} onChange={(e) => setA({ ...a, loginWindowEnd: e.target.value })} />
            </Field>
            <Field label="Suggest logout after" hint="Locks before this time are ignored" className="col-span-2">
              <Input type="time" value={a.logoutSuggestAfter} onChange={(e) => setA({ ...a, logoutSuggestAfter: e.target.value })} />
            </Field>
          </div>
          <Button loading={save.isPending} disabled={!dirty} onClick={saveAuto}>
            Save automation settings
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Webhook" description="Configure Tasker or MacroDroid with these values (step-by-step guide: android/README.md)." />
        <CardBody className="space-y-3 text-[13px]">
          <Field label="URL (POST)">
            <div className="flex gap-2">
              <Input readOnly value={endpoint} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Copy URL" onClick={() => copy(endpoint, "URL")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Field>
          <Field label="Header">
            <Input readOnly value="Authorization: Bearer <your device token>" className="font-mono text-xs" />
          </Field>
          <Field label="Body (JSON) — one request per event">
            <pre className="overflow-x-auto rounded-md bg-muted p-2.5 text-xs">{`{"event":"unlock","device":"Pixel 7"}\n{"event":"lock","device":"Pixel 7"}`}</pre>
          </Field>
          <p className="text-xs text-muted-foreground">
            <code>timestamp</code> is optional (ISO-8601, epoch seconds/ms, or <code>YYYY-MM-DD HH:MM</code> in Dhaka time). Leave it out and the server time is used. Offline events can be sent later with their original timestamp.
          </p>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Device tokens" description="Each phone gets its own token. A token is shown once, when created; only a hash is kept." />
        <CardBody className="space-y-3">
          <form
            className="flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (label.trim()) createToken.mutate();
            }}
          >
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. My Pixel 7" maxLength={60} aria-label="Token label" />
            <Button type="submit" loading={createToken.isPending} disabled={!label.trim()}>
              <Plus className="h-4 w-4" /> Create token
            </Button>
          </form>
          {s.deviceTokens.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tokens yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {s.deviceTokens.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{t.prefix}…</span> · created {dateTimeOf(t.createdAt)} · {t.lastUsedAt ? `last used ${dateTimeOf(t.lastUsedAt)}` : "never used"}
                    </p>
                  </div>
                  {t.revokedAt ? (
                    <Badge tone="gray">Revoked</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setRevoking(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!created}
        onOpenChange={(o) => !o && setCreated(null)}
        title="Copy your device token now"
        description="It will not be shown again. If you lose it, revoke it and create a new one."
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        {created && (
          <div className="space-y-2">
            <p className="text-[13px]">
              Token for <b>{created.label}</b>
            </p>
            <div className="flex gap-2">
              <Input readOnly value={created.token} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => copy(created.token, "Token")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this token?"
        description="The phone using it will immediately stop being able to send events."
        confirmLabel="Revoke"
        destructive
        loading={revoke.isPending}
        onConfirm={async () => {
          if (revoking !== null) await revoke.mutateAsync(revoking).catch(() => undefined);
          setRevoking(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ team lead */

function TeamLead({ s }: { s: SettingsResponse }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: s.profile.mentorName, email: "", password: "" });
  const [confirm, setConfirm] = useState(false);
  const done = (data: SettingsResponse) => qc.setQueryData(["settings"], data);

  const create = useMutation({
    mutationFn: () => api.post<SettingsResponse>("/settings/tl", { name: f.name.trim(), email: f.email.trim(), password: f.password }),
    onSuccess: (d) => {
      done(d);
      setF({ name: d.profile.mentorName, email: "", password: "" });
      toast.success("Team Lead account created — share the email and password with them");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: () => api.del<SettingsResponse>("/settings/tl"),
    onSuccess: (d) => {
      if (d) done(d);
      else void qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Team Lead unlinked");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader title="Team Lead access" description="A Team Lead account is read-only: it can open your submitted reports, comment, request a revision or approve. It can't see tasks, attendance or settings." />
        <CardBody className="space-y-3">
          {s.tl ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <UserCheck className="h-5 w-5 text-emerald-600" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="font-medium">{s.tl.name}</p>
                  <p className="text-xs text-muted-foreground">{s.tl.email}</p>
                </div>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirm(true)}>
                  Unlink
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Unlinking removes their access to your reports. If they mentor no one else their login is disabled.</p>
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="TL name">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} />
              </Field>
              <Field label="TL email">
                <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" />
              </Field>
              <Field label="Temporary password" hint="At least 10 characters. Tell your TL to keep it private.">
                <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete="new-password" />
              </Field>
              <Button type="submit" loading={create.isPending} disabled={!f.name.trim() || !f.email || f.password.length < 10}>
                Create Team Lead account
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Unlink your Team Lead?"
        description="They will no longer be able to open your reports."
        confirmLabel="Unlink"
        destructive
        loading={unlink.isPending}
        onConfirm={async () => {
          await unlink.mutateAsync().catch(() => undefined);
          setConfirm(false);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ security + data */

function Security({ s }: { s: SettingsResponse }) {
  const { logout } = useAuth();
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [err, setErr] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: () => {
      toast.success("Password changed. Other devices were signed out.");
      setPw({ current: "", next: "", again: "" });
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);

  async function download(kind: "json" | "csv") {
    setBusy(kind);
    try {
      const res = await fetch(kind === "json" ? "/api/export" : "/api/export/tasks.csv", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      downloadBlob(await res.blob(), `pims-${kind === "json" ? "backup" : "tasks"}-${localDate(new Date())}.${kind}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Change password" />
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              if (pw.next !== pw.again) return setErr("The new passwords don't match");
              change.mutate();
            }}
          >
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
            </Field>
            <Field label="New password" hint="At least 10 characters">
              <Input type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            </Field>
            <Field label="Repeat new password">
              <Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required />
            </Field>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <Button type="submit" loading={change.isPending} disabled={!pw.current || pw.next.length < 10}>
              Change password
            </Button>
          </form>
        </CardBody>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Backup & export" description="Download your data any time. Nothing is hidden in the browser — it all lives in your D1 database." />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="outline" loading={busy === "json"} onClick={() => download("json")}>
              <Download className="h-4 w-4" /> Full backup (JSON)
            </Button>
            <Button variant="outline" loading={busy === "csv"} onClick={() => download("csv")}>
              <Download className="h-4 w-4" /> Tasks (CSV)
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="This deployment" />
          <CardBody className="space-y-1 text-[13px] text-muted-foreground">
            <p>
              App: <span className="text-foreground">{s.meta.appName}</span>
            </p>
            <p>
              Timezone: <span className="text-foreground">{s.meta.timezone}</span>
            </p>
            <p>
              PDF storage (R2): <span className="text-foreground">{s.meta.r2Enabled ? "enabled — exported PDFs are also stored" : "not enabled (PDFs are generated in your browser)"}</span>
            </p>
          </CardBody>
        </Card>
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
