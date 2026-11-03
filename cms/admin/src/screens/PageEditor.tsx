// Edit one page: fields from the real page on the left, live preview on the right, auto-saved as a draft.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { addItem, buildFields, moveItem, removeItem, serialize, setImageAlt, splitScripts, writeField, type Field } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { ConflictError, createAutosaver, type SaveState } from "../lib/autosave.ts";
import { highlight, previewDoc } from "../lib/preview.ts";
import { SPLIT_FIELDS, SPLIT_GRID, SPLIT_PAGE } from "../lib/layout.ts";
import { Breadcrumb, Chip, SaveStatus } from "../components/ui.tsx";
import { FieldList } from "../components/FieldList.tsx";
import { LivePreview } from "../components/LivePreview.tsx";
import { SeoPanel, type Seo } from "../components/SeoPanel.tsx";
import { HistoryPanel } from "../components/HistoryPanel.tsx";

type PageData = { key: string; title: string; url: string; html: string; version: number; hasChanges: boolean; seo: Seo };
type Tab = "content" | "seo" | "history";
const IDLE: SaveState = { status: "idle", pending: false, savedAt: null, message: "" };
export function PageEditor() {
  const { key = "" } = useParams();
  const [page, setPage] = useState<PageData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("content");
  const [fields, setFields] = useState<Field[]>([]);
  const [tick, setTick] = useState(0);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(IDLE);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [reveal, setReveal] = useState<{ id: number; n: number } | null>(null);

  const version = useRef(0);
  const scripts = useRef<string[]>([]);
  const doc = useRef<Document | null>(null);
  const seo = useRef<Seo | null>(null);
  const pending = useRef({ html: false, seo: false });
  const saver = useRef<ReturnType<typeof createAutosaver> | null>(null);

  // Load the page (again after a restore).
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setFields([]);
    api<{ page: PageData }>(`/pages/${key}`)
      .then(({ page: p }) => {
        if (cancelled) return;
        version.current = p.version;
        seo.current = p.seo;
        setHasChanges(p.hasChanges);
        setPage(p);
      })
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, [key, reloadKey]);

  const srcDoc = useMemo(() => {
    if (!page) return "";
    const split = splitScripts(page.html);
    scripts.current = split.scripts;
    return previewDoc(split.html);
  }, [page]);

  // One auto-saver per page; flush on tab hide and when leaving the editor.
  useEffect(() => {
    const s = createAutosaver({
      onState: setSaveState,
      save: async () => {
        const send = { ...pending.current };
        pending.current = { html: false, seo: false };
        const body: Record<string, unknown> = { baseVersion: version.current };
        if (send.html && doc.current) body.html = serialize(doc.current, scripts.current);
        if (send.seo && seo.current) body.seo = seo.current;
        if (!("html" in body) && !("seo" in body)) return;
        const json = JSON.stringify(body);
        try {
          const r = await api<{ version: number; hasChanges: boolean }>(`/pages/${key}`, { method: "PUT", json: body, keepalive: document.visibilityState === "hidden" && json.length < 60000 });
          version.current = r.version;
          setHasChanges(r.hasChanges);
        } catch (e) {
          pending.current = { html: pending.current.html || send.html, seo: pending.current.seo || send.seo };
          if (e instanceof ApiError && (e.status === 409 || e.status === 422)) throw new ConflictError(e.message);
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
  }, [key]);

  const changed = useCallback((what: "html" | "seo") => {
    pending.current[what] = true;
    saver.current?.touch();
  }, []);

  const onReady = useCallback((d: Document) => {
    doc.current = d;
    setFields(buildFields(d));
    setTick((t) => t + 1);
  }, []);

  const rebuild = () => {
    if (!doc.current) return;
    setFields(buildFields(doc.current));
    setTick((t) => t + 1);
  };

  function onItem(op: "up" | "down" | "remove" | "add", f: Field) {
    const ok = op === "up" ? moveItem(f, -1) : op === "down" ? moveItem(f, 1) : op === "remove" ? removeItem(f) : !!addItem(f);
    if (!ok) {
      if (op === "remove") alertBox("Keep at least one item here.");
      return;
    }
    rebuild();
    changed("html");
  }

  async function restore(rev: { id: number; createdAt: string }) {
    await saver.current?.flush();
    try {
      await api(`/pages/${key}/revisions/${rev.id}/restore`, { method: "POST", json: { baseVersion: version.current } });
      setTab("content");
      setReloadKey((k) => k + 1);
      setHistoryRefresh((n) => n + 1);
    } catch (e) {
      alertBox(e instanceof Error ? e.message : "Couldn't restore that version.");
    }
  }

  const [notice, setNotice] = useState("");
  function alertBox(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3500);
  }

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError} <Link to="/pages" className="font-semibold underline">Back to Pages</Link></p>;

  return (
    <div className={`mx-auto max-w-[1600px] ${tab === "content" ? SPLIT_PAGE : ""}`}>
      <Breadcrumb items={[{ label: "Content" }, { label: "Pages", to: "/pages" }, { label: page?.title ?? "…" }]} />
      <Link to="/pages" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><span aria-hidden="true">←</span> Back to Pages</Link>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{page?.title ?? "Loading…"}</h1>
        <Chip tone="good">Published</Chip>
        {hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
        <span className="flex-1" />
        <SaveStatus state={saveState} />
        {page && <p className="order-last basis-full text-sm text-slate-500">URL: <span className="font-mono">liveaccess.ai{page.url}</span> · Changes save automatically as a draft. The live site changes only when you publish (Day 4).</p>}
      </div>

      {saveState.status === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{saveState.message} Your latest change was not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload page</button>
        </div>
      )}
      {notice && <p role="status" className="mb-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">{notice}</p>}

      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {(["content", "seo", "history"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize ${tab === t ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t === "seo" ? "SEO" : t}
          </button>
        ))}
      </div>

      <div className={tab === "content" ? `grid grid-cols-1 items-start gap-7 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] ${SPLIT_GRID}` : "grid grid-cols-1"}>
        {tab === "content" && (
          <div className={`grid min-w-0 content-start gap-4 ${SPLIT_FIELDS}`}>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">Each field is a piece of text or an image on the real page. Repeating items (cards, rows, list items, questions) can be added, moved or removed. The page design stays as it is.</p>
            <FieldList fields={fields} tick={tick}
              onChange={(f, v) => { writeField(f, v); changed("html"); }}
              onAlt={(f, alt) => { setImageAlt(f, alt); changed("html"); }}
              onItem={onItem}
              reveal={reveal}
              onFocusField={(f) => highlight(doc.current, f.el)} />
          </div>
        )}
        {page && (
          <div className="min-w-0 xl:h-full">
            <LivePreview key={`${page.key}-${reloadKey}`} srcDoc={srcDoc} url={page.url} visible={tab === "content"} onReady={onReady}
              onPick={(id) => setReveal({ id, n: Date.now() })} />
          </div>
        )}
        {tab === "seo" && page && <SeoPanel initial={seo.current ?? page.seo} url={page.url} onChange={(s) => { seo.current = s; changed("seo"); }} />}
        {tab === "history" && page && <HistoryPanel pageKey={page.key} refresh={historyRefresh} onRestore={restore} />}
      </div>
    </div>
  );
}
