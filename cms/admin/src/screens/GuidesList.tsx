// Troubleshooting guides: list with status, and "+ New guide" (starts as a draft).
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb, Chip } from "../components/ui.tsx";
import { inputCls, saveBtn } from "../components/form.tsx";

type Row = { id: number; slug: string; title: string; areaSlug: string; status: "draft" | "published"; live: boolean; hasChanges: boolean; updatedAt: string; updatedBy: string | null };

export function GuidesList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api<{ guides: Row[] }>("/guides").then((r) => setRows(r.guides)).catch((e) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { guide } = await api<{ guide: Row }>("/guides", { method: "POST", json: { title } });
      navigate(`/guides/${guide.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the guide.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Content" }, { label: "Troubleshooting guides" }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Troubleshooting guides</h1>
          <p className="mt-1 text-sm text-slate-500">Articles on liveaccess.ai/guide-….html. New guides start as drafts; the live site changes only when they're published.</p>
        </div>
        {!adding && <button type="button" onClick={() => setAdding(true)} className={saveBtn}>+ New guide</button>}
      </div>

      {adding && (
        <form onSubmit={create} className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="grid min-w-72 flex-1 gap-1.5 text-xs font-semibold" htmlFor="new-title">
            Title of the new guide
            <input id="new-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pump cavitation: causes and checks" className={`${inputCls} font-normal`} />
          </label>
          <button type="submit" disabled={busy || !title.trim()} className={saveBtn}>{busy ? "Creating…" : "Create draft"}</button>
          <button type="button" onClick={() => { setAdding(false); setTitle(""); }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Cancel</button>
        </form>
      )}

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr><th className="px-4 py-3 font-semibold">Guide</th><th className="px-4 py-3 font-semibold">Address</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last edited</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">No guides yet.</td></tr>}
            {rows?.map((g) => (
              <tr key={g.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/guides/${g.id}`)}>
                <td className="px-4 py-3 font-semibold">{g.title}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">/guide-{g.slug}.html</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    {g.live ? <Chip tone="good">Published</Chip> : <Chip tone="draft">Draft</Chip>}
                    {g.live && g.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(g.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{g.updatedBy ? ` · ${g.updatedBy}` : ""}</td>
                <td className="px-4 py-3 text-right"><Link to={`/guides/${g.id}`} onClick={(e) => e.stopPropagation()} className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold hover:border-slate-300">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
