import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageLoader } from "@/components/ui";
import { useAuth } from "@/hooks/use-auth";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { TasksPage } from "@/pages/TasksPage";
import { AttendancePage } from "@/pages/AttendancePage";
import { DevLogPage } from "@/pages/DevLogPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ReportHistoryPage } from "@/pages/ReportHistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFound } from "@/pages/NotFound";
import { PublicReportPage } from "@/pages/PublicReportPage";
import { TlLayout, TlReportPage, TlReportsPage } from "@/pages/TlPages";

// Charts are the heaviest dependency — load them only when needed.
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));

function Gate() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;

  if (user.role === "tl") {
    return (
      <Routes>
        <Route element={<TlLayout />}>
          <Route path="/tl" element={<TlReportsPage />} />
          <Route path="/tl/reports/:id" element={<TlReportPage />} />
          <Route path="*" element={<Navigate to="/tl" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="devlog" element={<DevLogPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="history" element={<ReportHistoryPage />} />
        <Route
          path="analytics"
          element={
            <Suspense fallback={<PageLoader />}>
              <AnalyticsPage />
            </Suspense>
          }
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public, read-only submitted report (secret link) — no sign-in required. */}
      <Route path="/r/:token" element={<PublicReportPage />} />
      <Route path="*" element={<Gate />} />
    </Routes>
  );
}
