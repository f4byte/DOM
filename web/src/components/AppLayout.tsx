import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { BarChart3, Bell, CheckCheck, Clock, Code2, FileText, History, LayoutDashboard, ListChecks, LogIn, LogOut, Menu, Monitor, Moon, Plus, Settings, Sun, X } from "lucide-react";
import { Button } from "@/components/ui";
import { QuickAddDialog } from "@/components/QuickAdd";
import { useAttendanceActions, useTodayAttendance } from "@/hooks/use-attendance";
import { useAuth } from "@/hooks/use-auth";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { greeting, timeWithSeconds, dateShort, localDate, timeOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/tasks", label: "My Tasks", icon: ListChecks },
  { to: "/attendance", label: "Attendance", icon: Clock },
  { to: "/devlog", label: "Development Log", icon: Code2 },
  { to: "/reports", label: "Daily Reports", icon: FileText },
  { to: "/history", label: "Report History", icon: History },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground", className)}>
      <CheckCheck className="h-4 w-4" />
    </span>
  );
}

function LiveClock() {
  const now = useNow(1000);
  return (
    <div className="hidden text-right leading-tight sm:block" title="Asia/Dhaka (UTC+6)">
      <div className="tnum text-[13px] font-medium">{timeWithSeconds(now)}</div>
      <div className="text-[11px] text-muted-foreground">{dateShort(localDate(now))} · Dhaka</div>
    </div>
  );
}

function ClockButton() {
  const { data } = useTodayAttendance();
  const { clockIn, clockOut } = useAttendanceActions();
  if (!data) return null;
  const a = data.attendance;
  if (!a.firstLoginAt) {
    return (
      <Button variant="success" size="sm" loading={clockIn.isPending} onClick={() => clockIn.mutate()}>
        <LogIn className="h-3.5 w-3.5" /> <span className="hidden md:inline">Clock in</span>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" loading={clockOut.isPending} onClick={() => clockOut.mutate()} title={a.lastLogoutAt ? `Last clock-out ${timeOf(a.lastLogoutAt)} — click to update to now` : `In since ${timeOf(a.firstLoginAt)}`}>
      <LogOut className="h-3.5 w-3.5" /> <span className="hidden md:inline">{a.lastLogoutAt ? "Update clock-out" : "Clock out"}</span>
    </Button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Theme: ${theme}. Switch to ${next}`} title={`Theme: ${theme}`}>
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { data: today } = useTodayAttendance();
  const [navOpen, setNavOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const loc = useLocation();
  const pending = today?.pendingEvents.length ?? 0;

  useEffect(() => setNavOpen(false), [loc.pathname]);
  // "N" opens quick add (when not typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setQuickAdd(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <Logo />
        <div className="leading-tight">
          <div className="text-sm font-semibold">DOM</div>
          <div className="text-[11px] text-muted-foreground">Internship Manager</div>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {to === "/attendance" && pending > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{pending}</span>}
          </NavLink>
        ))}
      </div>
      <div className="border-t p-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{(user?.fullName ?? "?").slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium">{user?.fullName}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-sidebar lg:block">{sidebar}</aside>
      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-sidebar shadow-pop">
            <button className="absolute right-2 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent" onClick={() => setNavOpen(false)} aria-label="Close menu">
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="hidden min-w-0 text-[13px] text-muted-foreground md:block">
            {greeting()}, <span className="font-medium text-foreground">{user?.fullName}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LiveClock />
            {pending > 0 && (
              <Link to="/attendance" className="relative rounded-md p-2 text-amber-600 hover:bg-accent" title={`${pending} device event${pending > 1 ? "s" : ""} waiting for your confirmation`}>
                <Bell className="h-4 w-4" />
                <span className="absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-500 px-0.5 text-[9px] font-bold text-white">{pending}</span>
              </Link>
            )}
            <ClockButton />
            <Button size="sm" onClick={() => setQuickAdd(true)} title="Quick add task (N)">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Quick add</span>
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <QuickAddDialog open={quickAdd} onOpenChange={setQuickAdd} />
    </div>
  );
}
