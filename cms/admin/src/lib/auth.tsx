import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearTokens, refreshIfExpiring, refreshSession, setSignedOutHandler, setTokens, type SignedIn } from "./api.ts";

export type User = { id: number; name: string; email: string; role: "super_admin" | "editor"; mustChangePassword: boolean };
type AuthState = { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; updateUser: (u: User) => void };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refreshSession()
      .then((s) => { if (s) setUser(s.user); })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));

    const onReturn = () => { if (document.visibilityState === "visible") refreshIfExpiring(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api<SignedIn>("/auth/login", { method: "POST", json: { email, password } });
    setTokens(s);
    setUser(s.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    clearTokens();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, updateUser: setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
