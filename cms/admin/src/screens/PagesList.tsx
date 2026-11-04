import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { Breadcrumb, Chip, EditLink } from "../components/ui.tsx";

type Row = { key: string; title: string; url: string; version: number; hasChanges: boolean; updatedAt: string; updatedBy: string | null };

export function PagesList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api<{ pages: Row[] }>("/pages").then((r) => setRows(r.pages)).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Content" }, { label: "Pages" }]} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Pages</h1>
        <p className="mt-1 text-sm text-slate-500">The website's fixed pages. Editors change text, images and SEO. The layout and design come from the page itself and can't be changed here.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase">
            <tr><th className="px-4 py-3 font-semibold">Page</th><th className="px-4 py-3 font-semibold">URL</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Last edited</th><th className="px-4 py-3 text-right font-semibold">Actions</th></tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td colSpan={5} className="px-4 py-6 text-slate-500">Loading…</td></tr>}
            {rows?.map((p) => (
              <tr key={p.key} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/pages/${p.key}`)}>
                <td className="px-4 py-3 font-semibold">{p.title}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.url}</td>
                <td className="px-4 py-3"><span className="flex flex-wrap gap-1.5"><Chip tone="good">Published</Chip>{p.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}</span></td>
                <td className="px-4 py-3 text-slate-500">{new Date(p.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{p.updatedBy ? ` · ${p.updatedBy}` : ""}</td>
                <td className="px-4 py-2 text-right"><EditLink to={`/pages/${p.key}`} name={p.title} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
