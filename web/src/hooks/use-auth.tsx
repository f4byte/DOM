import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthUserDTO } from "@shared/types";
import { api } from "@/lib/api";

interface Status {
  setupRequired: boolean;
  setupKeyRequired: boolean;
  authenticated: boolean;
  user: AuthUserDTO | null;
}

interface Ctx {
  status: Status;
  user: AuthUserDTO | null;
  login: (email: string, password: string) => Promise<void>;
  setup: (b: { fullName: string; email: string; password: string; mentorName: string; setupKey?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<Status>("/auth/status"), staleTime: 60_000, retry: false });

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["auth-status"] }), [qc]);

  /** Drop every cached query for the previous user, but keep the live auth-status query so the UI switches immediately. */
  const resetSession = useCallback(async () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth-status" });
    await qc.invalidateQueries({ queryKey: ["auth-status"] });
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post("/auth/login", { email, password });
      await resetSession();
    },
    [resetSession],
  );
  const setup = useCallback(
    async (b: { fullName: string; email: string; password: string; mentorName: string; setupKey?: string }) => {
      await api.post("/auth/setup", b);
      await resetSession();
    },
    [resetSession],
  );
  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    await resetSession();
  }, [resetSession]);

  if (q.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (q.isError || !q.data) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Can't reach the DOM server</p>
          <p className="mt-1 text-muted-foreground">{(q.error as Error | null)?.message}</p>
          <button className="mt-4 rounded-md bg-primary px-3 py-1.5 text-primary-foreground" onClick={() => q.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return <AuthContext.Provider value={{ status: q.data, user: q.data.user, login, setup, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
