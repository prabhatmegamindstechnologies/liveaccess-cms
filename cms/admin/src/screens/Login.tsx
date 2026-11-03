import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { ADMIN_PATH } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/pages" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/pages");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(90%_70%_at_100%_0%,#fde3d3_0%,#f1f5f9_60%)] px-4">
      <form onSubmit={submit} noValidate className="grid w-full max-w-sm gap-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-bright text-sm font-extrabold text-white">LA</span>
          <span className="leading-tight font-bold">LiveAccess Admin<span className="block text-xs font-medium text-slate-500">liveaccess.ai/{ADMIN_PATH}</span></span>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-slate-500">Use the email and password your Super Admin gave you.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="grid gap-1.5 text-sm font-semibold" htmlFor="email">
          Email
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-normal focus:border-brand-bright focus:bg-white" />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold" htmlFor="password">
          Password
          <span className="relative">
            <input id="password" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 pr-16 font-normal focus:border-brand-bright focus:bg-white" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 px-2 py-1 text-xs font-semibold text-brand">
              {show ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-[#a8370a] disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-slate-500">Forgot your password? Ask a Super Admin to reset it. After 5 wrong tries the account is locked for 15 minutes.</p>
      </form>
    </div>
  );
}
