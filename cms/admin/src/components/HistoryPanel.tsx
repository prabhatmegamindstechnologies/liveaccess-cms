import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

type Rev = { id: number; note: string; createdAt: string; by: string | null };

export function HistoryPanel({ pageKey, refresh, onRestore }: { pageKey: string; refresh: number; onRestore: (rev: Rev) => void }) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ revisions: Rev[] }>(`/pages/${pageKey}/revisions`).then((r) => setRevs(r.revisions)).catch((e) => setError(e.message));
  }, [pageKey, refresh]);

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Version history</h2>
      <p className="text-sm text-slate-500">A version is kept for each editing session and every publish. Restore loads it as the draft; nothing goes live until you publish.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th /></tr></thead>
          <tbody>
            {revs?.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-3 py-2">{r.by ?? "Import"}</td>
                <td className="px-3 py-2">{r.note}{i === 0 && <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-bold text-green-700">Latest</span>}</td>
                <td className="px-3 py-2 text-right">{i > 0 && <button type="button" onClick={() => onRestore(r)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:border-slate-300">Restore</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
