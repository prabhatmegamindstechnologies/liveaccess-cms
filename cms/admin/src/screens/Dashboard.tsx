// Dashboard: what's waiting to be published, new messages, the last publish and recent content edits.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { describeAudit, type AuditItem } from "../lib/audit.ts";
import { useAuth } from "../lib/auth.tsx";
import { Breadcrumb, Chip } from "../components/ui.tsx";

type Waiting = { kind: "page" | "guide" | "area"; title: string; link: string; state: "new" | "changed"; updatedAt: string; by: string | null };
type Activity = { id: number; action: string; at: string; who: string | null; item: AuditItem | null };
type Data = {
  waiting: { items: Waiting[]; total: number; newDrafts: number };
  activity: Activity[];
  messages: number;
  lastPublish: { status: string; at: string } | null;
};

const KINDS = { page: "Page", guide: "Guide", area: "Process area" };
const when = (at: string) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const linkCls = "text-sm font-semibold text-brand hover:underline";

function Tile({ label, value, note, to }: { label: string; value: ReactNode; note: string; to: string }) {
  return (
    <Link to={to} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300">
      <span className="block text-sm font-semibold text-slate-600">{label}</span>
      <span className="mt-1 block text-2xl font-bold tracking-tight">{value}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{note}</span>
    </Link>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api<Data>("/dashboard").then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  const waiting = data?.waiting;
  const publish = data?.lastPublish;

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Dashboard" }]} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">What's waiting to be published, new messages and recent edits.</p>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && waiting && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Waiting to publish" value={waiting.total} note={waiting.total ? "Pages, guides and areas" : "Everything is published"} to="/publish" />
            <Tile label="New drafts" value={waiting.newDrafts} note="Never published" to="/publish" />
            <Tile label="New messages" value={data.messages} note={data.messages ? "From the contact form" : "No new messages"} to="/inbox" />
            <Tile label="Last publish" value={publish ? <span className="capitalize">{publish.status}</span> : "None"} note={publish ? when(publish.at) : "Nothing published yet"} to="/publish" />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel title="Waiting to be published" action={<Link to="/publish" className={linkCls}>Publish centre</Link>}>
              {waiting.items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Everything is published.</p>}
              <ul>
                {waiting.items.map((w) => (
                  <li key={w.link} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0">
                    <span className="min-w-0">
                      <Link to={w.link} className="block truncate text-sm font-semibold hover:text-brand">{w.title}</Link>
                      <span className="block truncate text-xs text-slate-500">{KINDS[w.kind]} · {when(w.updatedAt)}{w.by ? ` · ${w.by}` : ""}</span>
                    </span>
                    {w.state === "new" ? <Chip tone="draft">New</Chip> : <Chip tone="changes">Changed</Chip>}
                  </li>
                ))}
              </ul>
              {waiting.total > waiting.items.length && (
                <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">Showing the {waiting.items.length} most recently edited of {waiting.total}.</p>
              )}
            </Panel>

            <Panel title="Recent activity" action={user?.role === "super_admin" ? <Link to="/audit" className={linkCls}>Audit log</Link> : undefined}>
              {data.activity.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No edits yet.</p>}
              <ul>
                {data.activity.map((e) => {
                  const text = describeAudit({ action: e.action, item: e.item, detail: {} });
                  return (
                    <li key={e.id} className="border-t border-slate-100 px-4 py-2.5 first:border-t-0">
                      {e.item?.link ? <Link to={e.item.link} className="block truncate text-sm hover:text-brand">{text}</Link> : <span className="block truncate text-sm">{text}</span>}
                      <span className="block truncate text-xs text-slate-500">{e.who ?? "Unknown"} · {when(e.at)}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
