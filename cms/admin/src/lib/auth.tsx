import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, setCsrfToken } from "./api.ts";

export type User = { id: number; name: string; email: string; role: "super_admin" | "editor"; mustChangePassword: boolean };
type AuthState = { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; updateUser: (u: User) => void };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User; csrfToken: string }>("/auth/me")
      .then((r) => { setCsrfToken(r.csrfToken); setUser(r.user); })
      .catch((e) => { if (!(e instanceof ApiError && e.status === 401)) console.error(e); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User; csrfToken: string }>("/auth/login", { method: "POST", json: { email, password } });
    setCsrfToken(r.csrfToken);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setCsrfToken("");
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, updateUser: setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
