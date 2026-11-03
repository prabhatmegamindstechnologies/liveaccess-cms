// Header and footer menus: edit labels, links and order, then Save (draft). The Publish centre applies them later.
import { useEffect, useMemo, useRef, useState } from "react";
import { applyMenus, MENU_LIMITS, splitScripts, type MenuLink, type Menus } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { previewDoc } from "../lib/preview.ts";
import { Breadcrumb, Chip } from "../components/ui.tsx";
import { FieldError, iconBtn, inputCls, LinkPicker, useUnsavedWarning, type Errors, type LinkOption } from "../components/form.tsx";

type MenusData = { menus: Menus; version: number; hasChanges: boolean; updatedAt: string | null; updatedBy: string | null; links: LinkOption[] };

const clone = (m: Menus): Menus => JSON.parse(JSON.stringify(m));

function LinkRows({ path, links, max, options, errors, onChange }: { path: string; links: MenuLink[]; max: number; options: LinkOption[]; errors: Errors; onChange: (links: MenuLink[]) => void }) {
  const set = (i: number, patch: Partial<MenuLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...links];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {links.map((l, i) => {
        const id = `${path}.${i}`;
        return (
          // Index keys: rows have no id of their own, and inputs are controlled, so values follow their row.
          <div key={i} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3" data-row={id}>
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.label || "New link"}</span>
              <button type="button" className={iconBtn} aria-label={`Move ${l.label || "link"} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className={iconBtn} aria-label={`Move ${l.label || "link"} down`} title="Move down" disabled={i === links.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className={iconBtn} aria-label={`Remove ${l.label || "link"}`} title="Remove" disabled={links.length === 1} onClick={() => onChange(links.filter((_, j) => j !== i))}>✕</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <label htmlFor={`${id}.label`} className="text-xs font-semibold">Label</label>
                <input id={`${id}.label`} value={l.label} maxLength={MENU_LIMITS.label} onChange={(e) => set(i, { label: e.target.value })}
                  aria-invalid={!!errors[`${id}.label`]} aria-describedby={errors[`${id}.label`] ? `${id}.label-err` : undefined} className={inputCls} />
                <FieldError id={`${id}.label-err`} msg={errors[`${id}.label`]} />
              </div>
              <LinkPicker id={`${id}.href`} value={l.href} options={options} error={errors[`${id}.href`]} onChange={(href) => set(i, { href })} />
            </div>
          </div>
        );
      })}
      <FieldError id={`${path}-err`} msg={errors[path]} />
      <div className="flex items-center gap-3">
        <button type="button" disabled={links.length >= max} onClick={() => onChange([...links, { label: "", href: "" }])}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:border-slate-300 disabled:opacity-40">+ Add link</button>
        <span className="text-xs text-slate-500">{links.length} of {max}</span>
      </div>
    </div>
  );
}

/** Home page with only its header and footer, the draft menus applied. */
function MenuPreview({ homeHtml, menus }: { homeHtml: string; menus: Menus }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(360);
  const srcDoc = useMemo(() => {
    let html: string;
    try { html = applyMenus(homeHtml, menus, "index.html"); } catch { return ""; }
    const start = html.indexOf("</header>") + "</header>".length, end = html.indexOf(`<footer class="site-footer">`);
    if (start < 9 || end < 0) return "";
    const compact = html.slice(0, start) + `<div style="height:40px"></div>` + html.slice(end);
    return previewDoc(splitScripts(compact).html);
  }, [homeHtml, menus]);

  useEffect(() => {
    const fit = () => box.current && setScale(Math.min(1, box.current.clientWidth / 1280));
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  function onLoad() {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    doc.addEventListener("click", (e) => e.preventDefault(), true);
    setHeight(doc.documentElement.scrollHeight);
  }

  return (
    <div ref={box} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ height: Math.ceil(height * scale) }}>
      {srcDoc && (
        <iframe ref={frame} title="Preview of the header and footer with these menus" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={onLoad}
          className="absolute top-0 left-0 block border-0" style={{ width: 1280, height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      )}
    </div>
  );
}

export function MenusEditor() {
  const [data, setData] = useState<MenusData | null>(null);
  const [homeHtml, setHomeHtml] = useState("");
  const [draft, setDraft] = useState<Menus | null>(null);
  const [saved, setSaved] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error" | "conflict"; text?: string }>({ kind: "idle" });
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([api<MenusData>("/menus"), api<{ page: { html: string } }>("/pages/home")])
      .then(([d, home]) => {
        setData(d);
        setDraft(clone(d.menus));
        setSaved(JSON.stringify(d.menus));
        setHomeHtml(home.page.html);
      })
      .catch((e) => setLoadError(e.message));
  }, []);

  const dirty = !!draft && JSON.stringify(draft) !== saved;

  useUnsavedWarning(dirty, "You have unsaved menu changes. Leave without saving?");

  async function save() {
    if (!draft || !data) return;
    setStatus({ kind: "saving" });
    setErrors({});
    try {
      const r = await api<{ version: number; hasChanges: boolean; menus: Menus; updatedAt: string }>("/menus", { method: "PUT", json: { baseVersion: data.version, menus: draft } });
      setData({ ...data, version: r.version, hasChanges: r.hasChanges, updatedAt: r.updatedAt });
      setDraft(clone(r.menus));
      setSaved(JSON.stringify(r.menus));
      setStatus({ kind: "saved", text: new Date(r.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors((e.body as { errors?: Errors } | null)?.errors ?? {});
        setStatus({ kind: "error", text: "Fix the highlighted fields, then save again." });
      } else if (e instanceof ApiError && e.status === 409) setStatus({ kind: "conflict", text: e.message });
      else setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save." });
    }
  }

  // Focus the first field with an error after a refused save.
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first) (document.getElementById(first) ?? document.getElementById(`${first}-err`))?.scrollIntoView({ block: "center" });
  }, [errors]);

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  if (!data || !draft) return <p className="text-sm text-slate-500">Loading the menus…</p>;

  const update = (fn: (m: Menus) => void) => setDraft((d) => { const next = clone(d!); fn(next); return next; });
  const statusText = dirty ? "Unsaved changes" : status.kind === "saved" ? `Saved ${status.text}` : "All changes saved";

  return (
    <div className="mx-auto max-w-[1400px]">
      <Breadcrumb items={[{ label: "Website" }, { label: "Menus" }]} />
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Menus</h1>
        {data.hasChanges && <Chip tone="changes">Unpublished changes</Chip>}
        <span className="flex-1" />
        <span role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold">
          <i aria-hidden="true" className={`size-2 rounded-full ${dirty ? "bg-amber-500" : "bg-green-600"}`} />{statusText}
        </span>
        <button type="button" onClick={save} disabled={!dirty || status.kind === "saving"}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a8370a] disabled:opacity-50">
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mb-5 text-sm text-slate-500">
        Header and footer links on every page. Only labels, links and order change; the header and footer design stay the same.
        Saved menus are a draft: the live site changes when they're published.
        {data.updatedBy && data.updatedAt && <> Last saved by {data.updatedBy}, {new Date(data.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.</>}
      </p>

      {status.kind === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{status.text} Your changes were not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload</button>
        </div>
      )}
      {status.kind === "error" && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{status.text}</p>}

      <section aria-label="Preview" className="mb-6 grid gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Preview (home page header and footer)</h2>
        {homeHtml && <MenuPreview homeHtml={homeHtml} menus={draft} />}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Header menu</h2>
          <LinkRows path="header.links" links={draft.header.links} max={MENU_LIMITS.header} options={data.links} errors={errors}
            onChange={(links) => update((m) => { m.header.links = links; })} />
          <div className="grid gap-3 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold">Button (top right)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <label htmlFor="header.button.label" className="text-xs font-semibold">Label</label>
                <input id="header.button.label" value={draft.header.button.label} maxLength={MENU_LIMITS.label}
                  onChange={(e) => update((m) => { m.header.button.label = e.target.value; })}
                  aria-invalid={!!errors["header.button.label"]} className={inputCls} />
                <FieldError id="header.button.label-err" msg={errors["header.button.label"]} />
              </div>
              <LinkPicker id="header.button.href" value={draft.header.button.href} options={data.links} error={errors["header.button.href"]}
                onChange={(href) => update((m) => { m.header.button.href = href; })} />
            </div>
          </div>
        </section>

        <div className="grid gap-6">
          {draft.footer.map((col, ci) => (
            <section key={ci} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Footer · {col.heading || "Column"}</h2>
              <div className="grid gap-1.5">
                <label htmlFor={`footer.${ci}.heading`} className="text-xs font-semibold">Column heading</label>
                <input id={`footer.${ci}.heading`} value={col.heading} maxLength={MENU_LIMITS.label}
                  onChange={(e) => update((m) => { m.footer[ci]!.heading = e.target.value; })}
                  aria-invalid={!!errors[`footer.${ci}.heading`]} className={inputCls} />
                <FieldError id={`footer.${ci}.heading-err`} msg={errors[`footer.${ci}.heading`]} />
              </div>
              <LinkRows path={`footer.${ci}.links`} links={col.links} max={MENU_LIMITS.column} options={data.links} errors={errors}
                onChange={(links) => update((m) => { m.footer[ci]!.links = links; })} />
              {ci === draft.footer.length - 1 && <p className="text-xs text-slate-500">The "Cookie settings" button always stays at the end of this column.</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
