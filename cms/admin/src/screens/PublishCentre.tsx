// Publish centre. For now: build the whole site from the drafts and open it on this computer. Nothing goes live from here.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb } from "../components/ui.tsx";

type Skipped = { kind: "page" | "guide" | "area"; id: number | string; title: string; reason: string; live: boolean };
type Build = { builtAt: string; counts: { pages: number; guides: number; areas: number; files: number }; skipped: Skipped[]; warnings: string[] };
type Preview = { running: boolean; last: Build | null; url: string };

const editor = (s: Skipped) => (s.kind === "page" ? `/pages/${s.id}` : `/${s.kind}s/${s.id}`);

export function PublishCentre() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Preview>("/publish/preview").then(setPreview).catch((e) => {
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      else setError(e.message);
    });
  }, []);

  async function build() {
    setBuilding(true);
    setError("");
    try {
      const last = await api<Build>("/publish/preview", { method: "POST" });
      setPreview((p) => (p ? { ...p, last } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  const last = preview?.last;
  const busy = building || preview?.running;
  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Admin" }, { label: "Publish centre" }]} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Publish centre</h1>
        <p className="mt-1 text-sm text-slate-500">Build the whole site from your drafts and check it on this computer. Nothing goes live, and your drafts stay as they are.</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {unavailable && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">The local preview is only available when the CMS runs on your own computer.</p>}

      {preview && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Local preview</h2>
              <p role="status" className="mt-0.5 text-sm text-slate-500">
                {busy ? "Building the site…" : last ? `Last built ${new Date(last.builtAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Not built since the CMS started."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a href={preview.url} target="_blank" rel="noopener" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Open site</a>
              <button type="button" onClick={build} disabled={!!busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-[#a8370a] disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Building…" : "Build preview"}
              </button>
            </div>
          </div>

          {last && (
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["Pages", last.counts.pages], ["Guides", last.counts.guides], ["Process areas", last.counts.areas], ["Files written", last.counts.files]] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-xl font-bold">{n}</dd>
                </div>
              ))}
            </dl>
          )}

          {last && last.skipped.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Drafts not in this preview</h3>
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {last.skipped.map((s) => (
                  <li key={`${s.kind}-${s.id}`} className="px-4 py-3 text-sm">
                    <Link to={editor(s)} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:text-brand">{s.title}</Link>
                    <span className="text-slate-500"> · {s.live ? "showing the live version" : "left out"}</span>
                    <p className="mt-0.5 text-slate-600">{s.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {last && last.warnings.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Worth checking</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {last.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
