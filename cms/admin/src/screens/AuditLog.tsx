// Audit log (Super Admin only): who did what and when. Read-only. Filters live in the address, so a view can be reloaded.
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { describeAudit, type AuditItem } from "../lib/audit.ts";
import { Breadcrumb, LineIcon, iconBtn } from "../components/ui.tsx";
import { inputCls } from "../components/form.tsx";

type Entry = { id: number; action: string; at: string; ip: string | null; detail: Record<string, unknown>; item: AuditItem | null; who: { id: number; name: string; email: string | null } | null };
type Data = { entries: Entry[]; total: number; page: number; pageSize: number; users: { id: number; name: string; email: string }[] };

const GROUPS = [["", "Everything except sign-ins"], ["content", "Content"], ["website", "Website settings"], ["users", "Users"], ["publishing", "Publishing"], ["messages", "Messages"], ["sign-ins", "Sign-ins"]] as const;
const LABELS: Record<string, string> = {
  fields: "Changed", role: "Role", status: "Status", email: "Email", title: "Title", slug: "Address", from: "From", to: "To",
  pages: "Pages", guides: "Guides", areas: "Process areas", files: "Files written", passwordSource: "Temporary password was", name: "Name", reason: "Reason", count: "Messages"
};
const showValue = (v: unknown) => {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") {
    const c = v as { from?: unknown; to?: unknown };
    return "from" in c ? `${String(c.from)} → ${String(c.to)}` : JSON.stringify(v);
  }
  return String(v);
};
/** A day picked in the browser's time zone, as the moment it starts. */
const dayStart = (day: string, addDays = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + addDays).toISOString();
};

export function AuditLog() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const group = params.get("group") ?? "", user = params.get("user") ?? "", from = params.get("from") ?? "", to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;

  useEffect(() => {
    const q = new URLSearchParams();
    if (group) q.set("group", group);
    if (user) q.set("user", user);
    if (from) q.set("from", dayStart(from));
    if (to) q.set("to", dayStart(to, 1));
    if (page > 1) q.set("page", String(page));
    let live = true;
    setError("");
    api<Data>(`/audit?${q}`).then((d) => { if (live) { setData(d); setOpen(null); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [group, user, from, to, page]);

  /** Changing a filter goes back to the first page. */
  const filter = (key: string, value: string) => setParams((p) => {
    if (value) p.set(key, value); else p.delete(key);
    p.delete("page");
    return p;
  });
  const goTo = (n: number) => setParams((p) => { p.set("page", String(n)); return p; });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(group || user || from || to);

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Admin" }, { label: "Audit log" }]} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-slate-500">Who changed what, and when. Entries can't be changed or deleted. Sign-ins are under their own filter; failed ones always show.</p>
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="a-group" className="text-xs font-semibold">Type of action</label>
          <select id="a-group" value={group} onChange={(e) => filter("group", e.target.value)} className={inputCls}>
            {GROUPS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="a-user" className="text-xs font-semibold">User</label>
          <select id="a-user" value={user} onChange={(e) => filter("user", e.target.value)} className={inputCls}>
            <option value="">Everyone</option>
            {data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="a-from" className="text-xs font-semibold">From</label>
          <input id="a-from" type="date" value={from} max={to || undefined} onChange={(e) => filter("from", e.target.value)} className={inputCls} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="a-to" className="text-xs font-semibold">To</label>
          <input id="a-to" type="date" value={to} min={from || undefined} onChange={(e) => filter("to", e.target.value)} className={inputCls} />
        </div>
        <button type="button" disabled={!filtered} onClick={() => setParams({})} title="Clear filters" aria-label="Clear filters"
          className="grid size-[38px] place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-brand disabled:pointer-events-none disabled:opacity-40">
          <LineIcon d="M6 6l12 12M18 6L6 18" />
        </button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold whitespace-nowrap">When</th><th className="px-4 py-3 font-semibold">Who</th>
              <th className="px-4 py-3 font-semibold">What</th><th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!data && !error && <tr><td colSpan={4} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {data?.entries.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">{filtered ? "Nothing matches these filters." : "Nothing here yet."}</td></tr>}
            {data?.entries.map((e) => {
              const details = Object.entries(e.detail);
              const text = describeAudit(e);
              return (
                <Fragment key={e.id}>
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{new Date(e.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {e.who ? <>{e.who.name}<span className="block text-xs text-slate-500">{e.who.email}</span></> : <span className="text-slate-500">Unknown</span>}
                    </td>
                    <td className="px-4 py-3">{e.item?.link ? <Link to={e.item.link} className="underline decoration-slate-300 underline-offset-2 hover:text-brand">{text}</Link> : text}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" aria-expanded={open === e.id} aria-label={`Details: ${text}`} title="Details" onClick={() => setOpen(open === e.id ? null : e.id)}
                        className={`${iconBtn} ${open === e.id ? "bg-brand-soft !text-brand" : ""}`}>
                        <LineIcon d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                      </button>
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={4} className="px-4 py-3">
                        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                          {details.map(([k, v]) => (
                            <Fragment key={k}><dt className="font-semibold text-slate-600">{LABELS[k] ?? k}</dt><dd className="break-words text-slate-700">{showValue(v)}</dd></Fragment>
                          ))}
                          <dt className="font-semibold text-slate-600">IP address</dt><dd className="text-slate-700">{e.ip ?? "Not recorded"}</dd>
                          <dt className="font-semibold text-slate-600">Exact time</dt><dd className="text-slate-700">{new Date(e.at).toLocaleString([], { dateStyle: "full", timeStyle: "medium" })}</dd>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>{data.total} {data.total === 1 ? "entry" : "entries"}</span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Newer</button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => goTo(page + 1)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Older</button>
          </span>
        </div>
      )}
    </div>
  );
}
