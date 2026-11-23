import { useState } from "react";
import { Logo } from "@/components/AppLayout";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/api";

/** Sign-in form, or the one-time first-run setup form while no account exists yet. */
export function LoginPage() {
  const { status } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-11 w-11 rounded-xl [&>svg]:h-5 [&>svg]:w-5" />
          <h1 className="mt-3 text-xl font-semibold">DOM</h1>
          <p className="text-[13px] text-muted-foreground">Personal Work Management System</p>
        </div>
        <Card>
          <CardBody className="p-5">{status.setupRequired ? <SetupForm /> : <SignInForm />}</CardBody>
        </Card>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Times shown in Asia/Dhaka (UTC+6)</p>
      </div>
    </div>
  );
}

function SignInForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-sm font-semibold">Sign in</h2>
      <Field label="Email">
        <Input type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
        Sign in
      </Button>
    </form>
  );
}

function SetupForm() {
  const { setup, status } = useAuth();
  const [f, setF] = useState({ fullName: "Hasibur Rahman", email: "", password: "", mentorName: "xyz", setupKey: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setup({
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        password: f.password,
        mentorName: f.mentorName.trim(),
        ...(status.setupKeyRequired ? { setupKey: f.setupKey } : {}),
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const ready = f.fullName.trim() && f.email && f.password.length >= 10 && f.mentorName.trim() && (!status.setupKeyRequired || f.setupKey);

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Create your account</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">First-run setup. This creates the single intern account and adds your two starting tasks.</p>
      </div>
      <Field label="Full name">
        <Input autoFocus required value={f.fullName} onChange={set("fullName")} />
      </Field>
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={f.email} onChange={set("email")} />
      </Field>
      <Field label="Password" hint="At least 10 characters">
        <Input type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set("password")} />
      </Field>
      <Field label="Mentor / Team Lead name">
        <Input required value={f.mentorName} onChange={set("mentorName")} />
      </Field>
      {status.setupKeyRequired && (
        <Field label="Setup key" hint="The SETUP_KEY secret configured on the Worker">
          <Input type="password" autoComplete="off" required value={f.setupKey} onChange={set("setupKey")} />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!ready}>
        Create account
      </Button>
    </form>
  );
}
