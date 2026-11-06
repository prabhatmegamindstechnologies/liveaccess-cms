// Change your own password: from the link by your name, or as the only screen until a temporary password is replaced.
import { useState, type FormEvent } from "react";
import { api, ApiError, setTokens, type SignedIn } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Breadcrumb } from "../components/ui.tsx";
import { FieldError, inputCls, saveBtn, type Errors } from "../components/form.tsx";

const MIN = 12;

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { updateUser, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    setError("");
    if (next.length < MIN) return setErrors({ newPassword: `Use at least ${MIN} characters.` });
    if (next !== repeat) return setErrors({ repeat: "The two new passwords don't match." });
    setErrors({});
    setBusy(true);
    try {
      const r = await api<SignedIn>("/auth/change-password", { method: "POST", json: { currentPassword: current, newPassword: next } });
      setTokens(r);
      updateUser(r.user);
      setCurrent(""); setNext(""); setRepeat("");
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors((err.body as { errors?: Errors } | null)?.errors ?? {});
      else setError(err instanceof Error ? err.message : "Couldn't change the password.");
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string, help?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">{label}</label>
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => set(e.target.value)} autoComplete={autoComplete} required maxLength={1024}
        aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-err` : undefined} className={inputCls} />
      {help && <span className="text-xs text-slate-500">{help}</span>}
      <FieldError id={`${id}-err`} msg={errors[id]} />
    </div>
  );

  const form = (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Your password is changed. Any other devices were signed out.</p>}
      {field("currentPassword", forced ? "Temporary password" : "Current password", current, setCurrent, "current-password")}
      {field("newPassword", "New password", next, setNext, "new-password", `At least ${MIN} characters.`)}
      {field("repeat", "New password again", repeat, setRepeat, "new-password")}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={saveBtn}>{busy ? "Saving…" : "Change password"}</button>
        {forced && <button type="button" onClick={logout} className="text-sm font-semibold text-slate-600 hover:text-slate-900">Sign out</button>}
      </div>
    </form>
  );

  if (forced) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold tracking-tight">Choose your password</h1>
          <p className="mt-1 mb-5 text-sm text-slate-500">You signed in with a temporary password. Choose your own to continue.</p>
          {form}
        </div>
      </main>
    );
  }
  return (
    <div className="mx-auto max-w-md">
      <Breadcrumb items={[{ label: "Change password" }]} />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Change password</h1>
      {form}
    </div>
  );
}
