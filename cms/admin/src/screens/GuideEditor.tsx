// Edit one troubleshooting guide: fields and blocks on the left, the real guide page on the right, auto-saved as a draft.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { renderGuidePage, slugify, splitScripts, validateGuide, type Guide } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { ConflictError, createAutosaver, type SaveState } from "../lib/autosave.ts";
import { mediaSrc, rememberMedia } from "../lib/media.ts";
import { previewDoc } from "../lib/preview.ts";
import { SPLIT_FIELDS, SPLIT_GRID, SPLIT_PAGE } from "../lib/layout.ts";
import { Breadcrumb, Chip, SaveStatus } from "../components/ui.tsx";
import { FieldError, inputCls, type Errors } from "../components/form.tsx";
import { BlockEditor } from "../components/BlockEditor.tsx";
import { LivePreview } from "../components/LivePreview.tsx";

type Meta = { id: number; status: "draft" | "published"; live: boolean; hasChanges: boolean; version: number; updatedAt: string; updatedBy: string | null };
type Loaded = { guide: Guide & Meta; areas: { slug: string; name: string }[]; template: string; problems: Errors; mediaFiles: Record<string, string> };
type Tab = "content" | "seo";
const IDLE: SaveState = { status: "idle", pending: false, savedAt: null, message: "" };
const pick = (g: Guide): Guide => ({ slug: g.slug, title: g.title, summary: g.summary, areaSlug: g.areaSlug, publishedDate: g.publishedDate, blocks: g.blocks, seo: g.seo });

export function GuideEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [saveState, setSaveState] = useState<SaveState>(IDLE);
  const [errors, setErrors] = useState<Errors>({});
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<Guide | null>(null);
  const current = useRef<Guide | null>(null);
  const version = useRef(0);
  const saver = useRef<ReturnType<typeof createAutosaver> | null>(null);

  useEffect(() => {
    api<Loaded>(`/guides/${id}`).then((d) => {
      rememberMedia(d.mediaFiles);
      setData(d);
      setMeta(d.guide);
      version.current = d.guide.version;
      const g = pick(d.guide);
      current.current = g;
      setGuide(g);
      setPreview(g);
    }).catch((e) => setLoadError(e.message));
  }, [id]);

  // One auto-saver per guide; flush when leaving.
  useEffect(() => {
    const s = createAutosaver({
      onState: setSaveState,
      save: async () => {
        if (!current.current) return;
        try {
          const r = await api<{ version: number; hasChanges: boolean; updatedAt: string }>(`/guides/${id}`, { method: "PUT", json: { baseVersion: version.current, ...current.current } });
          version.current = r.version;
          setErrors({});
          setMeta((m) => (m ? { ...m, version: r.version, hasChanges: r.hasChanges, updatedAt: r.updatedAt } : m));
        } catch (e) {
          // A field problem (e.g. a slug in use) is shown next to the field; the next change saves again.
          if (e instanceof ApiError && e.status === 422) { setErrors((e.body as { errors?: Errors } | null)?.errors ?? {}); return; }
          if (e instanceof ApiError && e.status === 409) throw new ConflictError(e.message);
          throw e;
        }
      }
    });
    saver.current = s;
    const onHide = () => { if (document.visibilityState === "hidden") void s.flush(); };
    const onUnload = (e: BeforeUnloadEvent) => { if (s.state().pending || s.state().status === "saving") e.preventDefault(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      void s.flush().finally(() => s.dispose());
    };
  }, [id]);

  // The preview follows the edits a moment later, so typing doesn't reload it on every key.
  useEffect(() => {
    const t = window.setTimeout(() => setPreview(guide), 400);
    return () => window.clearTimeout(t);
  }, [guide]);

  const update = (patch: Partial<Guide>) => {
    setGuide((g) => {
      const next = { ...g!, ...patch };
      current.current = next;
      return next;
    });
    saver.current?.touch();
  };

  const areaSet = useMemo(() => new Set(data?.areas.map((a) => a.slug) ?? []), [data]);
  // Sanitising sets innerHTML: do it in an inert document (no images load, no handlers run), never the admin page.
  const inert = useMemo(() => document.implementation.createHTMLDocument(""), []);
  const problems = useMemo(() => {
    if (!guide) return {};
    const r = validateGuide(guide, areaSet, inert);
    return r.ok ? {} : r.errors;
  }, [guide, areaSet, inert]);

  const srcDoc = useMemo(() => {
    if (!data?.template || !preview) return "";
    try {
      const area = data.areas.find((a) => a.slug === preview.areaSlug)?.name ?? "(choose a process area)";
      return previewDoc(splitScripts(renderGuidePage(data.template, { ...preview, slug: preview.slug || "draft" }, area, inert, mediaSrc)).html);
    } catch {
      return "";
    }
  }, [data, preview, inert]);

  async function remove() {
    if (!window.confirm("Delete this draft guide? This can't be undone.")) return;
    saver.current?.dispose();
    try {
      await api(`/guides/${id}`, { method: "DELETE" });
      navigate("/guides");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't delete the guide.");
    }
  }

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError} <Link to="/guides" className="font-semibold underline">Back to guides</Link></p>;
  if (!data || !guide || !meta) return <p className="text-sm text-slate-500">Loading the guide…</p>;

  const err = (k: string) => errors[k];
  const field = (key: string, labelText: string, input: React.ReactNode, help?: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`g-${key}`} className="text-xs font-semibold">{labelText}</label>
      {input}
      {help && <span className="text-[11px] text-slate-500">{help}</span>}
      <FieldError id={`g-${key}-err`} msg={err(key)} />
    </div>
  );
  const missing = Object.entries(problems);
  const status = Object.keys(errors).length ? <span role="status" className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700">Not saved: fix the marked fields</span> : <SaveStatus state={saveState} />;

  return (
    <div className={`mx-auto max-w-[1600px] ${SPLIT_PAGE}`}>
      <Breadcrumb items={[{ label: "Content" }, { label: "Troubleshooting guides", to: "/guides" }, { label: guide.title || "Untitled" }]} />
      <Link to="/guides" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><span aria-hidden="true">←</span> Back to guides</Link>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{guide.title || "Untitled guide"}</h1>
        {meta.live ? <Chip tone="good">Published</Chip> : <Chip tone="draft">Draft</Chip>}
        {meta.live && meta.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
        <span className="flex-1" />
        {status}
        {!meta.live && <button type="button" onClick={remove} className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50">Delete draft</button>}
        <p className="order-last basis-full text-sm text-slate-500">
          Address: <span className="font-mono">liveaccess.ai/guide-{guide.slug}.html</span> · Changes save automatically as a draft. The live site changes only when it's published.
        </p>
      </div>

      {saveState.status === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{saveState.message} Your latest change was not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload page</button>
        </div>
      )}

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
            {field("title", "Title", <input id="g-title" value={guide.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} className={`${inputCls} font-semibold`} />)}
            {field("slug", "Address", (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500">guide-</span>
                <input id="g-slug" value={guide.slug} maxLength={80} readOnly={meta.live} onChange={(e) => update({ slug: e.target.value.toLowerCase() })}
                  className={`${inputCls} font-mono ${meta.live ? "bg-slate-50 text-slate-500" : ""}`} />
                <span className="font-mono text-xs text-slate-500">.html</span>
                {!meta.live && <button type="button" onClick={() => update({ slug: slugify(guide.title) })} className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold hover:border-slate-300">From title</button>}
              </div>
            ), meta.live ? "This guide is live, so its address is locked (links to it would break)." : "Lower-case letters, numbers and hyphens. Locked once the guide is published.")}
            {field("summary", "Summary", <textarea id="g-summary" value={guide.summary} maxLength={300} rows={3} onChange={(e) => update({ summary: e.target.value })} className={`${inputCls} resize-y`} />,
              "The intro line under the title, and the text on the guide's card.")}
            <div className="grid gap-4 sm:grid-cols-2">
              {field("areaSlug", "Process area", (
                <select id="g-areaSlug" value={guide.areaSlug} onChange={(e) => update({ areaSlug: e.target.value })} className={inputCls}>
                  <option value="">Choose…</option>
                  {data.areas.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </select>
              ))}
              {field("publishedDate", "Published date", <input id="g-publishedDate" type="date" value={guide.publishedDate} onChange={(e) => update({ publishedDate: e.target.value })} className={inputCls} />)}
            </div>
            <p className="text-xs text-slate-500">Byline on the page: "By LiveAccess team, TPS".</p>
          </section>

          <section hidden={tab !== "content"} className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Guide content</h2>
            <BlockEditor blocks={guide.blocks} errors={errors} onChange={(blocks) => update({ blocks })} />
          </section>

          <section hidden={tab !== "seo"} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
            {field("seo.title", "Meta title", <input id="g-seo.title" value={guide.seo.title} maxLength={200} placeholder={guide.title} onChange={(e) => update({ seo: { ...guide.seo, title: e.target.value } })} className={inputCls} />,
              `Shown in search results and the browser tab. Empty = the title. ${guide.seo.title.length}/60 recommended.`)}
            {field("seo.description", "Meta description", <textarea id="g-seo.description" value={guide.seo.description} maxLength={500} rows={3} placeholder={guide.summary} onChange={(e) => update({ seo: { ...guide.seo, description: e.target.value } })} className={`${inputCls} resize-y`} />,
              `Empty = the summary. ${guide.seo.description.length}/155 recommended.`)}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={guide.seo.noindex} onChange={(e) => update({ seo: { ...guide.seo, noindex: e.target.checked } })} />
              Hide from search engines (noindex). It also leaves the sitemap.
            </label>
          </section>
        </div>

        <div className="min-w-0 xl:h-full">
          {srcDoc
            ? <LivePreview srcDoc={srcDoc} url={`/guide-${guide.slug}.html`} visible onReady={() => {}} onPick={() => {}} />
            : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">The preview isn't available (no guide page to show it in).</p>}
        </div>
      </div>
    </div>
  );
}
