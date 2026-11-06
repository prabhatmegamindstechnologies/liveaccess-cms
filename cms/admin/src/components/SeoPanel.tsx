import { useState } from "react";

export type Seo = { title: string; description: string; canonical: string; noindex: boolean };

const inputCls = "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-bright focus:bg-white";

function Counter({ n, max }: { n: number; max: number }) {
  return <span className={n > max ? "font-bold text-red-700" : ""}>{n} / {max}</span>;
}

export function SeoPanel({ initial, url, onChange }: { initial: Seo; url: string; onChange: (s: Seo) => void }) {
  const [seo, setSeo] = useState(initial);
  const update = (patch: Partial<Seo>) => {
    const next = { ...seo, ...patch };
    setSeo(next);
    onChange(next);
  };
  const shownTitle = seo.title || "LiveAccess";
  const shownDesc = seo.description || "No description yet. Google will pick text from the page.";

  return (
    <div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
      <div className="grid content-start gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Search engines</h2>
        <label className="grid gap-1.5 text-xs font-semibold" htmlFor="seo-title">Meta title
          <input id="seo-title" value={seo.title} onChange={(e) => update({ title: e.target.value })} className={inputCls} />
          <span className="flex justify-between font-normal text-slate-500"><span>The blue link in Google.</span><Counter n={seo.title.length} max={60} /></span>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold" htmlFor="seo-desc">Meta description
          <textarea id="seo-desc" rows={3} value={seo.description} onChange={(e) => update({ description: e.target.value })} className={`${inputCls} resize-y`} />
          <span className="flex justify-between font-normal text-slate-500"><span>Shown under the link. Aim for 120–160 characters.</span><Counter n={seo.description.length} max={160} /></span>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold" htmlFor="seo-canonical">Canonical URL (optional)
          <input id="seo-canonical" value={seo.canonical} placeholder={`https://liveaccess.ai${url}`} onChange={(e) => update({ canonical: e.target.value.trim() })} className={inputCls} />
          <span className="font-normal text-slate-500">Leave empty to use this page's own URL. Must start with https://liveaccess.ai/</span>
        </label>
        <label className="flex items-center gap-2 text-sm" htmlFor="seo-noindex">
          <input id="seo-noindex" type="checkbox" checked={seo.noindex} onChange={(e) => update({ noindex: e.target.checked })} />
          Hide this page from search engines (noindex)
        </label>
        <p className="text-xs text-slate-500">These values are written into the page head when you publish.</p>
      </div>
      <div className="grid content-start gap-4">
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Google preview</h2>
          <div className="grid gap-0.5 rounded-lg border border-slate-200 p-4 font-[Arial,sans-serif]">
            <span className="text-xs text-[#202124]">liveaccess.ai › {url.replace(/^\//, "") || "home"}</span>
            <span className="text-lg leading-snug text-[#1a0dab]">{shownTitle.length > 62 ? `${shownTitle.slice(0, 60)}…` : shownTitle}</span>
            <span className="text-sm text-[#4d5156]">{shownDesc.length > 162 ? `${shownDesc.slice(0, 160)}…` : shownDesc}</span>
          </div>
          {seo.noindex && <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">This page is set to noindex. It will not appear in Google.</p>}
        </div>
      </div>
    </div>
  );
}
