// Users & roles (Super Admin only): add and edit users, reset passwords, unlock and disable accounts.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb, Chip, LineIcon, PENCIL, iconBtn } from "../components/ui.tsx";
import { FieldError, inputCls, saveBtn, type Errors } from "../components/form.tsx";

type Role = "super_admin" | "editor";
type Source = "generated" | "typed";
type Person = { id: number; name: string; email: string; role: Role; status: "active" | "disabled"; locked: boolean; mustChangePassword: boolean; temporaryExpired: boolean; lastLoginAt: string | null };
type Secret = { person: Person; password: string; isNew: boolean };
type Confirm = { kind: "reset" | "disable" | "enable"; person: Person };

const roleName = (r: Role) => (r === "super_admin" ? "Super Admin" : "Editor");
const KEY = "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z";
const DISABLE = "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM4.9 4.9l14.2 14.2";
const ENABLE = "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM9 12l2 2 4-4";
const UNLOCK = "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 9.9-1";

/** A row action: the icon shows, hovering gives its name, and `label` names the user for screen readers. */
function RowAction({ icon, title, label, onClick }: { icon: string; title: string; label: string; onClick: () => void }) {
  return <button type="button" className={iconBtn} title={title} aria-label={label} onClick={onClick}><LineIcon d={icon} /></button>;
}

// No look-alikes, as this gets read out or typed by hand. 220 = 4 × 55, so every letter is equally likely.
const READABLE = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makePassword() {
  let out = "";
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < 220 && out.length < 20) out += READABLE[b % READABLE.length];
  }
  return out;
}

/** The temporary password, ready to use or to be changed before saving. */
function TempPasswordField({ value, error, onChange }: { value: string; error?: string; onChange: (v: string, source: Source) => void }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor="u-password" className="text-xs font-semibold">Temporary password</label>
      <div className="flex gap-2">
        <input id="u-password" value={value} onChange={(e) => onChange(e.target.value, "typed")} required minLength={12} maxLength={1024} autoComplete="off" spellCheck={false}
          aria-invalid={!!error} aria-describedby={`u-password-help${error ? " u-password-err" : ""}`} className={`${inputCls} font-mono`} />
        <button type="button" onClick={() => onChange(makePassword(), "generated")} className="rounded-lg border border-slate-200 px-3 text-sm font-semibold whitespace-nowrap hover:border-slate-300">New one</button>
      </div>
      <span id="u-password-help" className="text-xs text-slate-500">Use this one or type your own, at least 12 characters. They must change it at first sign-in, and it stops working after 72 hours.</span>
      <FieldError id="u-password-err" msg={error} />
    </div>
  );
}

/** Asked only for changes that give someone Super Admin access. */
function OwnPasswordField({ value, error, onChange }: { value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor="u-own" className="text-xs font-semibold">Your own password</label>
      <input id="u-own" type="password" value={value} onChange={(e) => onChange(e.target.value)} required autoComplete="current-password" maxLength={1024}
        aria-invalid={!!error} aria-describedby={`u-own-help${error ? " u-own-err" : ""}`} className={inputCls} />
      <span id="u-own-help" className="text-xs text-slate-500">Needed to confirm a change to a Super Admin.</span>
      <FieldError id="u-own-err" msg={error} />
    </div>
  );
}

/** A modal dialog: the browser keeps focus inside it and closes it on Esc. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title" className="m-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/40">
      <h2 id="dialog-title" className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </dialog>
  );
}

function UserForm({ person, isSelf, onClose, onSaved }: { person: Person | null; isSelf: boolean; onClose: () => void; onSaved: (p: Person, password?: string) => void }) {
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [role, setRole] = useState<Role>(person?.role ?? "editor");
  const [password, setPassword] = useState(makePassword);
  const [source, setSource] = useState<Source>("generated");
  const [own, setOwn] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Giving or taking away Super Admin access. The API checks the same thing.
  const needsOwn = !isSelf && (role === "super_admin" || person?.role === "super_admin") && role !== person?.role;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    const confirm = needsOwn ? { currentPassword: own } : {};
    try {
      if (person) {
        const r = await api<{ user: Person }>(`/users/${person.id}`, { method: "PATCH", json: { name, email, ...(isSelf ? {} : { role }), ...confirm } });
        onSaved(r.user);
      } else {
        const r = await api<{ user: Person; temporaryPassword: string }>("/users", { method: "POST", json: { name, email, role, password, passwordSource: source, ...confirm } });
        onSaved(r.user, r.temporaryPassword);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors((err.body as { errors?: Errors } | null)?.errors ?? {});
      else setError(err instanceof Error ? err.message : "Couldn't save.");
      setBusy(false);
    }
  }

  return (
    <Dialog title={person ? `Edit ${person.name}` : "Add user"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-1.5">
          <label htmlFor="u-name" className="text-xs font-semibold">Name</label>
          <input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off"
            aria-invalid={!!errors.name} aria-describedby={errors.name ? "u-name-err" : undefined} className={inputCls} />
          <FieldError id="u-name-err" msg={errors.name} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="u-email" className="text-xs font-semibold">Email</label>
          <input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off"
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "u-email-err" : undefined} className={inputCls} />
          <span className="text-xs text-slate-500">This is what they sign in with.</span>
          <FieldError id="u-email-err" msg={errors.email} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="u-role" className="text-xs font-semibold">Role</label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf} className={inputCls}>
            <option value="editor">Editor</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <span className="text-xs text-slate-500">
            {isSelf ? "You can't change your own role." : "Editors work on content. Super Admins can also change menus, SEO, site settings and users."}
          </span>
          <FieldError id="u-role-err" msg={errors.role} />
        </div>
        {!person && <TempPasswordField value={password} error={errors.password} onChange={(v, s) => { setPassword(v); setSource(s); }} />}
        {needsOwn && <OwnPasswordField value={own} error={errors.currentPassword} onChange={setOwn} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Cancel</button>
          <button type="submit" disabled={busy} className={saveBtn}>{busy ? "Saving…" : person ? "Save" : "Add user"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The only moment the temporary password exists outside the user's head. */
function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(secret.password);
    setCopied(true);
  }
  return (
    <Dialog title={secret.isNew ? "User added" : "Password reset"} onClose={onClose}>
      <p className="text-sm text-slate-600">
        Give this temporary password to <b>{secret.person.name}</b> ({secret.person.email}) in a safe way. They'll choose their own when they sign in. It stops working after 72 hours.
      </p>
      <label htmlFor="temp-password" className="mt-4 block text-xs font-semibold">Temporary password</label>
      <div className="mt-1.5 flex gap-2">
        <input id="temp-password" readOnly value={secret.password} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono`} />
        <button type="button" onClick={copy} className="rounded-lg border border-slate-200 px-3 text-sm font-semibold whitespace-nowrap hover:border-slate-300">{copied ? "Copied" : "Copy"}</button>
      </div>
      <p role="note" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This password won't be shown again. If it's lost, reset the password.</p>
      <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className={saveBtn}>Done</button></div>
    </Dialog>
  );
}

function ConfirmDialog({ confirm, busy, error, errors, onClose, onYes }: { confirm: Confirm; busy: boolean; error: string; errors: Errors; onClose: () => void; onYes: (data: Record<string, string>) => void }) {
  const { kind, person } = confirm;
  const [password, setPassword] = useState(makePassword);
  const [source, setSource] = useState<Source>("generated");
  const [own, setOwn] = useState("");
  const reset = kind === "reset", needsOwn = person.role === "super_admin";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onYes({ ...(reset ? { password, passwordSource: source } : {}), ...(needsOwn ? { currentPassword: own } : {}) });
  };
  const text = {
    reset: { title: `Reset ${person.name}'s password?`, body: "Their current password stops working and they're signed out.", yes: "Reset password" },
    disable: { title: `Disable ${person.name}?`, body: "They're signed out at once and can't sign in. Their name stays on past edits, and you can enable them again later.", yes: "Disable user" },
    enable: { title: `Enable ${person.name}?`, body: "They can sign in again with their password.", yes: "Enable user" }
  }[kind];
  return (
    <Dialog title={text.title} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-slate-600">{text.body}</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {reset && <TempPasswordField value={password} error={errors.password} onChange={(v, s) => { setPassword(v); setSource(s); }} />}
        {needsOwn && <OwnPasswordField value={own} error={errors.currentPassword} onChange={setOwn} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Cancel</button>
          <button type="submit" disabled={busy} className={saveBtn}>{busy ? "Working…" : text.yes}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function UsersList() {
  const [rows, setRows] = useState<Person[] | null>(null);
  const [me, setMe] = useState(0);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [confirmErrors, setConfirmErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);

  useEffect(() => {
    api<{ users: Person[]; me: number }>("/users").then((r) => { setRows(r.users); setMe(r.me); }).catch((e) => setError(e.message));
  }, []);

  const put = (p: Person) => setRows((list) => {
    const all = list ?? [];
    return all.some((u) => u.id === p.id) ? all.map((u) => (u.id === p.id ? p : u)) : [...all, p].sort((a, b) => a.name.localeCompare(b.name));
  });

  async function run(data: Record<string, string>) {
    if (!confirm) return;
    const { kind, person } = confirm;
    setBusy(true);
    setConfirmError("");
    setConfirmErrors({});
    try {
      if (kind === "reset") {
        const r = await api<{ user: Person; temporaryPassword: string }>(`/users/${person.id}/reset-password`, { method: "POST", json: data });
        put(r.user);
        setSecret({ person: r.user, password: r.temporaryPassword, isNew: false });
      } else {
        const r = await api<{ user: Person }>(`/users/${person.id}`, { method: "PATCH", json: { status: kind === "disable" ? "disabled" : "active", ...data } });
        put(r.user);
      }
      setConfirm(null);
    } catch (e) {
      const fields = e instanceof ApiError && e.status === 422 ? (e.body as { errors?: Errors } | null)?.errors : undefined;
      if (fields) setConfirmErrors(fields);
      else setConfirmError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock(p: Person) {
    setError("");
    try {
      put((await api<{ user: Person }>(`/users/${p.id}/unlock`, { method: "POST" })).user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unlock this account.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Admin" }, { label: "Users & roles" }]} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users &amp; roles</h1>
          <p className="mt-1 text-sm text-slate-500">Who can sign in here. Editors work on content; Super Admins can also change menus, SEO, site settings and users.</p>
        </div>
        <button type="button" onClick={() => setEditing("new")} className={saveBtn}>+ Add user</button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th><th className="px-4 py-3 font-semibold">Role</th><th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Last sign-in</th><th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {rows?.map((p) => {
              const self = p.id === me;
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <span className="font-semibold">{p.name}</span>{self && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                    <span className="block text-xs text-slate-500">{p.email}</span>
                  </td>
                  <td className="px-4 py-3">{roleName(p.role)}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1.5">
                      <Chip tone={p.status === "active" ? "good" : "draft"}>{p.status === "active" ? "Active" : "Disabled"}</Chip>
                      {p.locked && <Chip tone="changes">Locked</Chip>}
                      {p.mustChangePassword && <Chip tone={p.temporaryExpired ? "changes" : "draft"}>{p.temporaryExpired ? "Temporary password expired" : "Temporary password"}</Chip>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never"}</td>
                  <td className="px-4 py-3">
                    <span className="flex justify-end gap-0.5">
                      {p.locked && <RowAction icon={UNLOCK} title="Unlock" label={`Unlock ${p.name}`} onClick={() => unlock(p)} />}
                      <RowAction icon={PENCIL} title="Edit" label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
                      {!self && <RowAction icon={KEY} title="Reset password" label={`Reset password for ${p.name}`} onClick={() => setConfirm({ kind: "reset", person: p })} />}
                      {!self && (p.status === "active"
                        ? <RowAction icon={DISABLE} title="Disable" label={`Disable ${p.name}`} onClick={() => setConfirm({ kind: "disable", person: p })} />
                        : <RowAction icon={ENABLE} title="Enable" label={`Enable ${p.name}`} onClick={() => setConfirm({ kind: "enable", person: p })} />)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserForm person={editing === "new" ? null : editing} isSelf={editing !== "new" && editing.id === me} onClose={() => setEditing(null)}
          onSaved={(p, password) => { put(p); setEditing(null); if (password) setSecret({ person: p, password, isNew: true }); }} />
      )}
      {confirm && <ConfirmDialog confirm={confirm} busy={busy} error={confirmError} errors={confirmErrors} onClose={() => { setConfirm(null); setConfirmError(""); setConfirmErrors({}); }} onYes={run} />}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}
