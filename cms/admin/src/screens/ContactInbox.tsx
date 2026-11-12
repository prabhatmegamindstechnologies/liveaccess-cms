// Contact inbox: messages sent from the website's contact form. A list with status tabs, a topic filter and search on the
// left, the open message on the right (one at a time on phones). Filters and the open message live in the address.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { Breadcrumb, LineIcon } from "../components/ui.tsx";
import { inputCls } from "../components/form.tsx";

type Status = "new" | "read" | "replied" | "archived";
type Message = {
  id: number; name: string; email: string; company: string; topic: string; message: string; page: string;
  status: Status; receivedAt: string; statusChangedAt: string; statusChangedBy: string | null;
};
type ListData = { messages: Message[]; total: number; page: number; pageSize: number; counts: Record<Status | "all", number>; topics: string[]; canDelete: boolean };

const TABS: { key: Status | "all"; label: string }[] = [
  { key: "new", label: "New" }, { key: "read", label: "Read" }, { key: "replied", label: "Replied" }, { key: "archived", label: "Archived" }, { key: "all", label: "All" }
];
const STATUS_TEXT: Record<Status, string> = { new: "New", read: "Read", replied: "Replied", archived: "Archived" };
const STATUS_TONE: Record<Status, string> = {
  new: "bg-brand-soft text-brand", read: "bg-slate-100 text-slate-600", replied: "bg-green-50 text-green-700", archived: "bg-slate-100 text-slate-500"
};
const MAIL = "M4 6h16v12H4zM4 7l8 6 8-6";
const BACK = "M15 18l-6-6 6-6";
const COPY = "M9 9h11v11H9zM5 15H4V4h11v1";

const btn = "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:border-slate-300 disabled:opacity-50";

/** Today: the time. This year: day and month. Older: the full date. */
function shortWhen(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
const longWhen = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/**
 * A reply link. The address is encoded, so a "?" or "&" in it (both allowed in email addresses) can't add a BCC or a
 * different body to the reply.
 */
const replyLink = (m: Message) =>
  `mailto:${encodeURIComponent(m.email).replace(/%40/g, "@")}?subject=${encodeURIComponent("Re: your LiveAccess enquiry")}`;

function StatusChip({ status }: { status: Status }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS_TONE[status]}`}>{STATUS_TEXT[status]}</span>;
}

function MessageView({ id, canDelete, onChanged, onClose }: { id: number; canDelete: boolean; onChanged: () => void; onClose: () => void }) {
  const [m, setM] = useState<Message | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    setM(null);
    setError("");
    setCopied(false);
    // Opening a new message marks it read, so the list's counts change too.
    api<{ message: Message }>(`/messages/${id}`).then((r) => {
      if (!live) return;
      setM(r.message);
      onChanged();
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { if (m) heading.current?.focus(); }, [m?.id]);

  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (status: Status) => run(async () => {
    setM((await api<{ message: Message }>(`/messages/${id}`, { method: "PATCH", json: { status } })).message);
    onChanged();
  }, "Couldn't change the status.");
  const remove = () => {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    void run(async () => {
      await api(`/messages/${id}`, { method: "DELETE" });
      onChanged();
      onClose();
    }, "Couldn't delete the message.");
  };
  const copy = async () => {
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m.email);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the address and copy it instead.");
    }
  };

  if (!m) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-slate-500">Loading the message…</p>}
      </div>
    );
  }
  return (
    <article aria-labelledby="msg-title" className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <button type="button" onClick={onClose} className="-mt-1 inline-flex w-fit items-center gap-1 text-sm font-semibold text-brand hover:underline lg:hidden">
        <LineIcon d={BACK} />Back to messages
      </button>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="msg-title" ref={heading} tabIndex={-1} className="text-xl font-bold tracking-tight break-words outline-none">{m.name}</h2>
            {m.company && <p className="text-sm text-slate-600">{m.company}</p>}
          </div>
          <StatusChip status={m.status} />
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="font-semibold text-slate-500">Email</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] break-all">{m.email}</span>
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold hover:border-slate-300">
              <LineIcon d={COPY} />{copied ? "Copied" : "Copy"}
            </button>
          </dd>
          <dt className="font-semibold text-slate-500">Interested in</dt>
          <dd>{m.topic || "—"}</dd>
          <dt className="font-semibold text-slate-500">Received</dt>
          <dd>{longWhen(m.receivedAt)}</dd>
          {m.statusChangedBy && m.status !== "new" && (
            <>
              <dt className="font-semibold text-slate-500">Marked {STATUS_TEXT[m.status].toLowerCase()}</dt>
              <dd>by {m.statusChangedBy}, {longWhen(m.statusChangedAt)}</dd>
            </>
          )}
        </dl>
      </header>

      <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-slate-800">{m.message}</div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <a href={replyLink(m)} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-[#a8370a]">
          <LineIcon d={MAIL} />Reply by email
        </a>
        {m.status !== "replied" && <button type="button" disabled={busy} onClick={() => void setStatus("replied")} className={btn}>Mark as replied</button>}
        {m.status === "archived"
          ? <button type="button" disabled={busy} onClick={() => void setStatus("read")} className={btn}>Move back to inbox</button>
          : <button type="button" disabled={busy} onClick={() => void setStatus("archived")} className={btn}>Archive</button>}
        {m.status !== "new" && <button type="button" disabled={busy} onClick={() => void setStatus("new")} className={btn}>Mark as unread</button>}
        {canDelete && <button type="button" disabled={busy} onClick={remove} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 sm:ml-auto">Delete</button>}
      </div>
      <p className="text-[11px] text-slate-500">
        "Reply by email" opens your email app. Mark the message as replied once you've sent it.
        Replied and archived messages are deleted automatically 12 months after they were handled.
      </p>
    </article>
  );
}

export function ContactInbox() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "new") as Status | "all";
  const topic = params.get("topic") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const open = Number(params.get("id") ?? 0) || null;
  const [search, setSearch] = useState(q);
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  // On a phone the chosen tab may be off to the side: bring it into view.
  useEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && tabs.current) tabs.current.scrollLeft = Math.max(0, el.offsetLeft - (tabs.current.clientWidth - el.offsetWidth) / 2);
  }, [status]);

  const update = (changes: Record<string, string | null>, keepPage = false) => setParams((p) => {
    for (const [k, v] of Object.entries(changes)) { if (v) p.set(k, v); else p.delete(k); }
    if (!keepPage) p.delete("page");
    return p;
  });

  // Search waits until typing stops.
  useEffect(() => {
    if (search === q) return;
    const t = window.setTimeout(() => update({ q: search.trim() || null }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const p = new URLSearchParams({ status });
    if (topic) p.set("topic", topic);
    if (q) p.set("q", q);
    if (page > 1) p.set("page", String(page));
    let live = true;
    api<ListData>(`/messages?${p}`).then((d) => { if (live) { setData(d); setError(""); } }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [status, topic, q, page, tick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(topic || q);
  const refresh = () => setTick((t) => t + 1);

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Contact inbox" }]} />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Contact inbox</h1>
      <p className="mb-5 text-sm text-slate-500">Messages sent from the contact form on the website. Opening a new message marks it as read.</p>

      {/* Swipeable on narrow screens, without a visible scrollbar. The grey line is drawn inside, so nothing overflows downwards. */}
      <div ref={tabs} role="tablist" aria-label="Message status"
        className="mb-4 flex overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_#e2e8f0] [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const n = data?.counts[t.key];
          return (
            <button key={t.key} role="tab" type="button" aria-selected={status === t.key} onClick={() => update({ status: t.key === "new" ? null : t.key, id: null })}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm font-semibold sm:gap-2 sm:px-3 ${status === t.key ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t.label}
              {n !== undefined && <span className={`rounded-full px-2 py-px text-xs ${t.key === "new" && n > 0 ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="min-w-0 flex-1 basis-60">
          <span className="sr-only">Search messages</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} placeholder="Search name, email, company or message" className={inputCls} />
        </label>
        <label className="basis-52">
          <span className="sr-only">Topic</span>
          <select value={topic} onChange={(e) => update({ topic: e.target.value || null })} className={inputCls}>
            <option value="">All topics</option>
            {(data?.topics ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section aria-label="Messages" className={`min-w-0 ${open ? "hidden lg:block" : ""}`}>
          {!data ? (error ? null : <p className="text-sm text-slate-500">Loading…</p>) : data.messages.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              {filtered
                ? <><p className="font-semibold">No messages match.</p><p className="mt-1 text-sm text-slate-500">Try another search or topic.</p></>
                : <><p className="font-semibold">No {status === "all" ? "" : `${STATUS_TEXT[status as Status].toLowerCase()} `}messages.</p>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">Messages sent from the contact form on the website appear here.</p></>}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {data.messages.map((m) => {
                  const unread = m.status === "new", current = m.id === open;
                  return (
                    <li key={m.id}>
                      <button type="button" aria-current={current ? "true" : undefined} onClick={() => update({ id: String(m.id) }, true)}
                        className={`grid w-full gap-1 px-4 py-3 text-left hover:bg-slate-50 ${current ? "bg-brand-soft/60 shadow-[inset_3px_0_0_var(--color-brand)]" : ""}`}>
                        <span className="flex items-baseline gap-2">
                          {unread && <i aria-hidden="true" className="size-2 shrink-0 translate-y-[-1px] rounded-full bg-brand" />}
                          <span className={`min-w-0 flex-1 truncate ${unread ? "font-bold" : "font-semibold text-slate-700"}`}>
                            {m.name}{m.company && <span className="font-normal text-slate-500"> · {m.company}</span>}
                          </span>
                          <time dateTime={m.receivedAt} className="shrink-0 text-xs text-slate-500">{shortWhen(m.receivedAt)}</time>
                        </span>
                        <span className="truncate text-sm text-slate-600">{m.message}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-semibold text-slate-600">{m.topic}</span>
                          {status === "all" && !unread && <StatusChip status={m.status} />}
                          {unread && <span className="sr-only">New</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {pages > 1 && (
                <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-sm">
                  <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, true)} className={btn}>Previous</button>
                  <span className="text-slate-500">Page {page} of {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, true)} className={btn}>Next</button>
                </nav>
              )}
            </>
          )}
        </section>

        <div className={`min-w-0 lg:sticky lg:top-4 ${open ? "" : "hidden lg:block"}`}>
          {open && data
            ? <MessageView key={open} id={open} canDelete={data.canDelete} onChanged={refresh} onClose={() => update({ id: null }, true)} />
            : <div className="hidden place-items-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-20 text-center text-sm text-slate-500 lg:grid">Choose a message to read it.</div>}
        </div>
      </div>
    </div>
  );
}
