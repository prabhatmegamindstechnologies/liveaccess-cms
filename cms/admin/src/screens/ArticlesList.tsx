// Troubleshooting guides and process areas: list with status, and "+ New …" (starts as a draft).
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb, Chip } from "../components/ui.tsx";
import { inputCls, saveBtn } from "../components/form.tsx";

type Row = { id: number; slug: string; title: string; status: "draft" | "published"; live: boolean; hasChanges: boolean; updatedAt: string; updatedBy: string | null };
type Kind = "guide" | "area";

const TEXT: Record<Kind, { title: string; intro: string; add: string; noun: string; label: string; placeholder: string; column: string }> = {
  guide: {
    title: "Troubleshooting guides", intro: "Articles on liveaccess.ai/guide-….html. New guides start as drafts; the live site changes only when they're published.",
    add: "+ New guide", noun: "guide", label: "Title of the new guide", placeholder: "e.g. Pump cavitation: causes and checks", column: "Guide"
  },
  area: {
    title: "Process areas", intro: "Pages on liveaccess.ai/area-….html, one per Expert Network area. Each lists its troubleshooting guides automatically.",
    add: "+ New area", noun: "area", label: "Name of the new area", placeholder: "e.g. Filtration", column: "Area"
  }
};

export function ArticlesList({ kind }: { kind: Kind }) {
  const t = TEXT[kind];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setRows(null);
    api<Record<string, Row[]>>(`/${kind}s`).then((r) => setRows(r[`${kind}s`] ?? [])).catch((e) => setError(e.message));
  }, [kind]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<Record<string, Row>>(`/${kind}s`, { method: "POST", json: { title } });
      navigate(`/${kind}s/${r[kind]!.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't create the ${t.noun}.`);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Content" }, { label: t.title }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
        </div>
        {!adding && <button type="button" onClick={() => setAdding(true)} className={saveBtn}>{t.add}</button>}
      </div>

      {adding && (
        <form onSubmit={create} className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="grid min-w-72 flex-1 gap-1.5 text-xs font-semibold" htmlFor="new-title">
            {t.label}
            <input id="new-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t.placeholder} className={`${inputCls} font-normal`} />
          </label>
          <button type="submit" disabled={busy || !title.trim()} className={saveBtn}>{busy ? "Creating…" : "Create draft"}</button>
          <button type="button" onClick={() => { setAdding(false); setTitle(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Cancel</button>
        </form>
      )}

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr><th className="px-4 py-3 font-semibold">{t.column}</th><th className="px-4 py-3 font-semibold">Address</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last edited</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">Nothing here yet.</td></tr>}
            {rows?.map((g) => (
              <tr key={g.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/${kind}s/${g.id}`)}>
                <td className="px-4 py-3 font-semibold">{g.title}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">/{kind}-{g.slug}.html</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    {g.live ? <Chip tone="good">Published</Chip> : <Chip tone="draft">Draft</Chip>}
                    {g.live && g.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(g.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{g.updatedBy ? ` · ${g.updatedBy}` : ""}</td>
                <td className="px-4 py-3 text-right"><Link to={`/${kind}s/${g.id}`} onClick={(e) => e.stopPropagation()} className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold hover:border-slate-300">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
