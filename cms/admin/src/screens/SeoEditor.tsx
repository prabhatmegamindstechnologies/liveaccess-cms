// SEO & redirects: redirect rules, robots.txt, llms.txt and SEO defaults (each saved as a draft), plus the sitemap
// that will be generated on publish. Per-page titles and descriptions live on each page's SEO tab.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Redirect, SeoDefaults } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb } from "../components/ui.tsx";
import { FieldError, iconBtn, inputCls, LinkPicker, SavedPill, saveBtn, useUnsavedWarning, type Errors, type LinkOption } from "../components/form.tsx";

type Part<T> = { value: T; version: number; updatedAt: string | null; updatedBy: string | null };
type SeoData = {
  redirects: Part<Redirect[]>; robots: Part<string>; llms: Part<string>; defaults: Part<SeoDefaults>;
  sitemap: { xml: string; count: number }; links: LinkOption[]; canEdit: boolean;
};
const ReadOnly = createContext(false);
type Tab = "redirects" | "files" | "defaults";
type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; text?: string };
const TABS: { id: Tab; label: string }[] = [{ id: "redirects", label: "Redirects" }, { id: "files", label: "Sitemap, robots & llms.txt" }, { id: "defaults", label: "Defaults" }];

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stamp = (p: Part<unknown>) => (p.updatedBy && p.updatedAt ? `Last saved by ${p.updatedBy}, ${new Date(p.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` : "");

/** One saveable part: its draft value, version, field errors and save status. */
function usePart<T>(name: string, initial: Part<T>) {
  const [value, setValue] = useState<T>(initial.value);
  const [saved, setSaved] = useState(JSON.stringify(initial.value));
  const [meta, setMeta] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const dirty = JSON.stringify(value) !== saved;
  useUnsavedWarning(dirty);

  async function save() {
    setStatus({ kind: "saving" });
    setErrors({});
    try {
      const r = await api<{ version: number; updatedAt: string; value: T }>(`/seo/${name}`, { method: "PUT", json: { baseVersion: meta.version, value } });
      setValue(r.value);
      setSaved(JSON.stringify(r.value));
      setMeta({ ...meta, version: r.version, updatedAt: r.updatedAt });
      setStatus({ kind: "saved", text: time(r.updatedAt) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors((e.body as { errors?: Errors } | null)?.errors ?? {});
        setStatus({ kind: "error", text: "Fix what's marked in red, then save again." });
      } else if (e instanceof ApiError && e.status === 409) setStatus({ kind: "conflict", text: e.message });
      else setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save." });
    }
  }
  return { value, setValue, dirty, errors, status, save, meta };
}

function SaveBar({ p, label = "Save" }: { p: { dirty: boolean; status: Status; save: () => void; meta: Part<unknown> }; label?: string }) {
  if (useContext(ReadOnly)) return null;
  return (
    <div className="grid gap-2">
      {p.status.kind === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{p.status.text} Your changes were not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload</button>
        </div>
      )}
      {p.status.kind === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{p.status.text}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-xs text-slate-500">{stamp(p.meta)}</span>
        <SavedPill dirty={p.dirty} savedAt={p.status.kind === "saved" ? p.status.text : undefined} />
        <button type="button" onClick={p.save} disabled={!p.dirty || p.status.kind === "saving"} className={saveBtn}>
          {p.status.kind === "saving" ? "Saving…" : label}
        </button>
      </div>
    </div>
  );
}

function RedirectsTab({ initial, links }: { initial: Part<Redirect[]>; links: LinkOption[] }) {
  const p = usePart("redirects", initial);
  const rows = p.value;
  const set = (i: number, patch: Partial<Redirect>) => p.setValue(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Redirects ({rows.length})</h2>
        <p className="mt-1 text-sm text-slate-500">Send an old address to a page that still exists. Use 301 for a permanent move (search engines update their links), 302 for a short-term one.</p>
      </div>
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No redirects yet.</p>}
      {rows.map((r, i) => (
        // Index keys: rows have no id of their own, and inputs are controlled, so values follow their row.
        <div key={i} data-row={i} className="grid items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto]">
          <div className="grid gap-1.5">
            <label htmlFor={`${i}.from`} className="text-xs font-semibold">Old address</label>
            <input id={`${i}.from`} value={r.from} placeholder="/old-page" onChange={(e) => set(i, { from: e.target.value })}
              aria-invalid={!!p.errors[`${i}.from`]} aria-describedby={p.errors[`${i}.from`] ? `${i}.from-err` : undefined} className={`${inputCls} font-mono`} />
            <FieldError id={`${i}.from-err`} msg={p.errors[`${i}.from`]} />
          </div>
          <LinkPicker id={`${i}.to`} label="Goes to" value={r.to} options={links} error={p.errors[`${i}.to`]} onChange={(to) => set(i, { to })} />
          <div className="grid gap-1.5">
            <label htmlFor={`${i}.code`} className="text-xs font-semibold">Type</label>
            <select id={`${i}.code`} value={r.code} onChange={(e) => set(i, { code: Number(e.target.value) as 301 | 302 })} className={inputCls}>
              <option value={301}>301 Permanent</option>
              <option value={302}>302 Temporary</option>
            </select>
            <FieldError id={`${i}.code-err`} msg={p.errors[`${i}.code`]} />
          </div>
          <button type="button" className={`${iconBtn} md:mt-6`} aria-label={`Remove redirect ${r.from || i + 1}`} title="Remove"
            onClick={() => p.setValue(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <FieldError id="redirects-err" msg={p.errors.redirects} />
      <div>
        <button type="button" onClick={() => p.setValue([...rows, { from: "", to: "", code: 301 }])}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:border-slate-300">+ Add redirect</button>
      </div>
      <SaveBar p={p} label="Save redirects" />
    </section>
  );
}

function TextFileCard({ name, title, help, initial }: { name: "robots" | "llms"; title: string; help: string; initial: Part<string> }) {
  const p = usePart(name, initial);
  const id = `${name}-text`;
  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <p className="text-sm text-slate-500">{help}</p>
      <label htmlFor={id} className="text-xs font-semibold">Contents</label>
      <textarea id={id} value={p.value} onChange={(e) => p.setValue(e.target.value)} spellCheck={false} rows={name === "robots" ? 14 : 18}
        aria-invalid={!!p.errors.value} aria-describedby={p.errors.value ? `${id}-err` : undefined}
        className={`${inputCls} resize-y font-mono text-xs leading-relaxed`} />
      <FieldError id={`${id}-err`} msg={p.errors.value} />
      <SaveBar p={p} label={`Save ${title}`} />
    </section>
  );
}

function DefaultsTab({ initial }: { initial: Part<SeoDefaults> }) {
  const p = usePart("defaults", initial);
  const d = p.value;
  const field = (key: keyof SeoDefaults, label: string, help: string, input: ReactNode) => (
    <div className="grid gap-1.5">
      <label htmlFor={`d-${key}`} className="text-xs font-semibold">{label}</label>
      {input}
      <span className="text-xs text-slate-500">{help}</span>
      <FieldError id={`d-${key}-err`} msg={p.errors[key]} />
    </div>
  );
  const props = (key: keyof SeoDefaults) => ({ id: `d-${key}`, "aria-invalid": !!p.errors[key], "aria-describedby": p.errors[key] ? `d-${key}-err` : undefined });
  return (
    <section className="grid max-w-3xl gap-5 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Site-wide defaults</h2>
      <p className="-mt-3 text-sm text-slate-500">The site name is edited in Site settings.</p>
      {field("description", "Default description", "Used for new articles that don't have their own meta description yet (max 300 characters).",
        <textarea {...props("description")} value={d.description} maxLength={300} rows={3} onChange={(e) => p.setValue({ ...d, description: e.target.value })} className={`${inputCls} resize-y`} />)}
      {field("shareImage", "Default share image", "The picture shown when a page is shared and has no image of its own: a site image such as logo.png, or a full https:// address.",
        <input {...props("shareImage")} value={d.shareImage} onChange={(e) => p.setValue({ ...d, shareImage: e.target.value })} className={`${inputCls} font-mono`} />)}
      {field("cardType", "Twitter / X card", "How links to the site look on X: a small square image, or a large image across the post.",
        <select {...props("cardType")} value={d.cardType} onChange={(e) => p.setValue({ ...d, cardType: e.target.value as SeoDefaults["cardType"] })} className={inputCls}>
          <option value="summary">Summary (small image)</option>
          <option value="summary_large_image">Summary with large image</option>
        </select>)}
      <SaveBar p={p} label="Save defaults" />
    </section>
  );
}

export function SeoEditor() {
  const [data, setData] = useState<SeoData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("redirects");
  useEffect(() => {
    api<SeoData>("/seo").then(setData).catch((e) => setLoadError(e.message));
  }, []);

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading SEO settings…</p>;

  return (
    <div className="mx-auto max-w-[1400px]">
      <Breadcrumb items={[{ label: "Website" }, { label: "SEO & redirects" }]} />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">SEO &amp; redirects</h1>
      <p className="mb-5 text-sm text-slate-500">
        Meta title and description are set on each page and article (SEO tab). Site-wide SEO lives here.
        Saved changes are drafts: the live site changes when they're published.
      </p>

      {!data.canEdit && <p role="note" className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-900">Only a Super Admin can change these. You can see the current values here.</p>}

      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.id ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabs stay mounted (only hidden) so unsaved typing survives switching tabs. */}
      <ReadOnly.Provider value={!data.canEdit}>
      <fieldset disabled={!data.canEdit} className="contents">
      <div role="tabpanel" id="panel-redirects" aria-labelledby="tab-redirects" hidden={tab !== "redirects"}>
        <RedirectsTab initial={data.redirects} links={data.links} />
      </div>
      <div role="tabpanel" id="panel-files" aria-labelledby="tab-files" hidden={tab !== "files"} className="grid items-start gap-6 xl:grid-cols-2">
        <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">sitemap.xml (generated, {data.sitemap.count} URLs)</h2>
          <pre tabIndex={0} aria-label="Generated sitemap.xml" className="max-h-[32rem] overflow-auto rounded-lg bg-navy p-4 font-mono text-xs leading-relaxed text-slate-100">{data.sitemap.xml}</pre>
          <p className="text-sm text-slate-500">Built from the published pages, guides and process areas. Pages set to noindex and drafts are left out automatically.</p>
        </section>
        <div className="grid gap-6">
          <TextFileCard name="robots" title="robots.txt" initial={data.robots}
            help="Tells search engines and AI crawlers what they may read. Keep the Sitemap line; blocking the whole site isn't allowed here." />
          <TextFileCard name="llms" title="llms.txt" initial={data.llms}
            help="Plain-text summary for AI assistants (Markdown). Keep the facts current when the app or pages change." />
        </div>
      </div>
      <div role="tabpanel" id="panel-defaults" aria-labelledby="tab-defaults" hidden={tab !== "defaults"}>
        <DefaultsTab initial={data.defaults} />
      </div>
      </fieldset>
      </ReadOnly.Provider>
    </div>
  );
}
