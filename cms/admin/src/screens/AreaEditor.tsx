// Edit one process area: fields and blocks on the left (saved with the Save button), the real area page on the right.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { plainText, renderAreaPage, slugify, splitScripts, validateArea, type Area } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { mediaSrc, rememberMedia } from "../lib/media.ts";
import { previewDoc } from "../lib/preview.ts";
import { SPLIT_FIELDS, SPLIT_GRID, SPLIT_PAGE } from "../lib/layout.ts";
import { Breadcrumb, Chip } from "../components/ui.tsx";
import { FieldError, inputCls, SavedPill, saveBtn, useUnsavedWarning, type Errors } from "../components/form.tsx";
import { BlockEditor } from "../components/BlockEditor.tsx";
import { RichField } from "../components/RichField.tsx";
import { LivePreview } from "../components/LivePreview.tsx";

type Meta = { id: number; status: "draft" | "published"; live: boolean; hasChanges: boolean; version: number; updatedAt: string; updatedBy: string | null };
type AreaGuide = { id: number; slug: string; title: string; summary: string; status: string; live: boolean };
type Loaded = { area: Area & Meta; guides: AreaGuide[]; template: string; problems: Errors; mediaFiles: Record<string, string> };
type Tab = "content" | "seo";
type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; text?: string };
const pick = (a: Area): Area => ({ slug: a.slug, title: a.title, summary: a.summary, blocks: a.blocks, seo: a.seo });

export function AreaEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [saved, setSaved] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<Area | null>(null);
  // Sanitising sets innerHTML: do it in an inert document (no images load, no handlers run), never the admin page.
  const inert = useMemo(() => document.implementation.createHTMLDocument(""), []);

  useEffect(() => {
    api<Loaded>(`/areas/${id}`).then((d) => {
      const a = pick(d.area);
      rememberMedia(d.mediaFiles);
      setData(d); setMeta(d.area); setArea(a); setPreview(a); setSaved(JSON.stringify(a));
    }).catch((e) => setLoadError(e.message));
  }, [id]);

  const dirty = !!area && JSON.stringify(area) !== saved;
  useUnsavedWarning(dirty, "You have unsaved changes to this area. Leave without saving?");

  // The preview follows the edits a moment later, so typing doesn't reload it on every key.
  useEffect(() => {
    const t = window.setTimeout(() => setPreview(area), 400);
    return () => window.clearTimeout(t);
  }, [area]);

  const problems = useMemo(() => {
    if (!area) return {};
    const r = validateArea(area, inert);
    return r.ok ? {} : r.errors;
  }, [area, inert]);

  const srcDoc = useMemo(() => {
    if (!data?.template || !preview) return "";
    try {
      // Only live guides are on the live area page.
      const guides = data.guides.filter((g) => g.live);
      return previewDoc(splitScripts(renderAreaPage(data.template, { ...preview, slug: preview.slug || "draft" }, guides, inert, mediaSrc)).html);
    } catch {
      return "";
    }
  }, [data, preview, inert]);

  const update = (patch: Partial<Area>) => setArea((a) => ({ ...a!, ...patch }));

  async function save() {
    if (!area || !meta) return;
    setStatus({ kind: "saving" });
    setErrors({});
    try {
      const r = await api<{ version: number; hasChanges: boolean; updatedAt: string; area: Area & Meta }>(`/areas/${id}`, { method: "PUT", json: { baseVersion: meta.version, ...area } });
      const a = pick(r.area);
      setArea(a);
      setSaved(JSON.stringify(a));
      setMeta({ ...meta, version: r.version, hasChanges: r.hasChanges, updatedAt: r.updatedAt, updatedBy: r.area.updatedBy });
      setStatus({ kind: "saved", text: new Date(r.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors((e.body as { errors?: Errors } | null)?.errors ?? {});
        setStatus({ kind: "error", text: "Fix what's marked in red, then save again." });
      } else if (e instanceof ApiError && e.status === 409) setStatus({ kind: "conflict", text: e.message });
      else setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save." });
    }
  }

  async function remove() {
    if (!window.confirm("Delete this draft area? This can't be undone.")) return;
    try {
      await api(`/areas/${id}`, { method: "DELETE" });
      navigate("/areas");
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't delete the area." });
    }
  }

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError} <Link to="/areas" className="font-semibold underline">Back to process areas</Link></p>;
  if (!data || !area || !meta) return <p className="text-sm text-slate-500">Loading the area…</p>;

  const field = (key: string, label: string, input: ReactNode, help?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`a-${key}`} className="text-xs font-semibold">{label}</label>
      {input}
      {help && <span className="text-[11px] text-slate-500">{help}</span>}
      <FieldError id={`a-${key}-err`} msg={errors[key]} />
    </div>
  );
  const missing = Object.entries(problems);

  return (
    <div className={`mx-auto max-w-[1600px] ${SPLIT_PAGE}`}>
      <Breadcrumb items={[{ label: "Content" }, { label: "Process areas", to: "/areas" }, { label: area.title || "Untitled" }]} />
      <Link to="/areas" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><span aria-hidden="true">←</span> Back to process areas</Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{area.title || "Untitled area"}</h1>
        {meta.live ? <Chip tone="good">Published</Chip> : <Chip tone="draft">Draft</Chip>}
        {meta.live && meta.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
        <span className="flex-1" />
        <SavedPill dirty={dirty} savedAt={status.kind === "saved" ? status.text : undefined} />
        {!meta.live && <button type="button" onClick={remove} className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">Delete draft</button>}
        <button type="button" onClick={save} disabled={!dirty || status.kind === "saving"} className={saveBtn}>{status.kind === "saving" ? "Saving…" : "Save"}</button>
        <p className="order-last basis-full text-sm text-slate-500">
          Address: <span className="font-mono">liveaccess.ai/area-{area.slug}.html</span> · Saved changes are a draft. The live site changes only when it's published.
        </p>
      </div>

      {status.kind === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{status.text} Your changes were not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload</button>
        </div>
      )}
      {status.kind === "error" && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{status.text}</p>}

      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {(["content", "seo"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t === "seo" ? "SEO" : "Content"}
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] ${SPLIT_GRID}`}>
        <div className={`grid min-w-0 content-start gap-5 ${SPLIT_FIELDS}`}>
          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Before publishing ({missing.length}):</p>
              <ul className="mt-1 list-disc pl-5">{missing.slice(0, 8).map(([k, v]) => <li key={k}>{k.startsWith("blocks.") ? `Block ${Number(k.split(".")[1]) + 1}: ` : ""}{v}</li>)}</ul>
            </div>
          )}

          <section hidden={tab !== "content"} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
            {field("title", "Name", <input id="a-title" value={area.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} className={`${inputCls} font-semibold`} />,
              "The page title. Also used in \"Guides for …\" and \"Questions about …?\" on the page.")}
            {field("slug", "Address", (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500">area-</span>
                <input id="a-slug" value={area.slug} maxLength={80} readOnly={meta.live} onChange={(e) => update({ slug: e.target.value.toLowerCase() })}
                  className={`${inputCls} font-mono ${meta.live ? "bg-slate-50 text-slate-500" : ""}`} />
                <span className="font-mono text-xs text-slate-500">.html</span>
                {!meta.live && <button type="button" onClick={() => update({ slug: slugify(area.title) })} className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:border-slate-300">From name</button>}
              </div>
            ), meta.live ? "This area is live, so its address is locked (links to it would break)." : "Lower-case letters, numbers and hyphens. Locked once the area is published.")}
            {field("summary", "Intro line", <RichField id="a-summary" label="Intro line" value={area.summary} onChange={(html) => update({ summary: html })} />,
              "Under the name on the page, with its formatting. The area's card and search results show the words only. Up to 300 characters.")}
          </section>

          <section hidden={tab !== "content"} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Guides in this area ({data.guides.length})</h2>
            {data.guides.length === 0
              ? <p className="text-sm text-slate-500">No guides yet. In a guide, choose this area under "Process area".</p>
              : <ul className="grid gap-1.5">{data.guides.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 text-sm">
                    <Link to={`/guides/${g.id}`} className="min-w-0 flex-1 truncate font-semibold text-brand hover:underline">{g.title}</Link>
                    {g.live ? <Chip tone="good">Published</Chip> : <Chip tone="draft">Draft</Chip>}
                  </li>
                ))}</ul>}
            <p className="text-[11px] text-slate-500">The "Guides for …" band on the page lists the published ones automatically.</p>
          </section>

          <section hidden={tab !== "content"} className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Area content</h2>
            <BlockEditor blocks={area.blocks} errors={errors} onChange={(blocks) => update({ blocks })} />
          </section>

          <section hidden={tab !== "seo"} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
            {field("seo.title", "Meta title", <input id="a-seo.title" value={area.seo.title} maxLength={200} placeholder={`${area.title}: process area | LiveAccess`} onChange={(e) => update({ seo: { ...area.seo, title: e.target.value } })} className={inputCls} />,
              `Shown in search results and the browser tab. Empty = "<name>: process area | LiveAccess". ${area.seo.title.length}/60 recommended.`)}
            {field("seo.description", "Meta description", <textarea id="a-seo.description" value={area.seo.description} maxLength={500} rows={3} placeholder={plainText(area.summary, inert)} onChange={(e) => update({ seo: { ...area.seo, description: e.target.value } })} className={`${inputCls} resize-y`} />,
              `Empty = the intro line. ${area.seo.description.length}/155 recommended.`)}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={area.seo.noindex} onChange={(e) => update({ seo: { ...area.seo, noindex: e.target.checked } })} />
              Hide from search engines (noindex). It also leaves the sitemap.
            </label>
          </section>
        </div>

        <div className="min-w-0 xl:h-full">
          {srcDoc
            ? <LivePreview srcDoc={srcDoc} url={`/area-${area.slug}.html`} visible onReady={() => {}} onPick={() => {}} />
            : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">The preview isn't available (no area page to show it in).</p>}
        </div>
      </div>
    </div>
  );
}
