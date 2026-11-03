import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "../lib/auth.tsx";
import tpsLogo from "../assets/tps-logo.png";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
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
    <div className="grid min-h-screen place-items-center bg-slate-50 bg-[radial-gradient(40%_35%_at_50%_0%,#fde7dc_0%,transparent_100%)] px-4 py-10">
      <div className="grid w-full max-w-md gap-7">
        <img src={tpsLogo} alt="TPS" width={190} height={40} className="mx-auto h-11 w-auto" />
        <form onSubmit={submit} noValidate className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 sm:p-10">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <span className="relative">
              <MailIcon />
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                className={`${inputCls} pr-3`} />
            </span>
          </div>
          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <span className="relative">
              <LockIcon />
              <input id="password" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-16`} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
                {show ? "Hide" : "Show"}
              </button>
            </span>
          </div>
          <button type="submit" disabled={busy} className="mt-1 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white shadow-sm hover:bg-[#a8370a] disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="text-center">
            <button type="button" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-controls="login-help"
              className="text-sm font-medium text-brand hover:underline">
              Forgot password?
            </button>
            <p id="login-help" hidden={!help} className="mt-2 text-xs text-slate-500">
              Ask a Super Admin to reset it. After 5 wrong tries the account is locked for 15 minutes.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 text-sm placeholder:text-slate-400 focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 focus:outline-none";
const iconCls = "pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400";

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={iconCls}>
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={iconCls}>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
