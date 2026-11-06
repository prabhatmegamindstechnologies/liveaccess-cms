// The pieces of the Media library, and the window that picks an image from it for a page, guide or area.
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api.ts";
import { fileSize, fileUrl, type MediaItem, type MediaPage } from "../lib/media.ts";
import { FieldError, inputCls, saveBtn, type Errors } from "./form.tsx";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = "image/jpeg,image/png,image/webp";
export const plainBtn = "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:border-slate-300 disabled:opacity-50";

export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`grid max-h-[90vh] w-full grid-rows-[auto_minmax(0,1fr)] rounded-xl bg-white shadow-xl outline-none ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900">✕</button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** One page of the library, following a search. */
export function useMediaList() {
  const [query, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MediaPage | null>(null);
  const [error, setError] = useState("");
  const asked = useRef(0);

  const load = useCallback(async () => {
    const ask = ++asked.current;
    try {
      const r = await api<MediaPage>(`/media?page=${page}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`);
      // A slower, older answer must not replace a newer one.
      if (ask !== asked.current) return;
      setData(r);
      setError("");
    } catch (e) {
      if (ask === asked.current) setError(e instanceof Error ? e.message : "Couldn't load the images.");
    }
  }, [page, query]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const setQuery = (q: string) => { setQueryValue(q); setPage(1); };
  return { query, setQuery, page, setPage, data, error, reload: load };
}

export function MediaSearch({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  return <input type="search" aria-label="Search images" placeholder="Search by file name or alt text" value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} className={`${inputCls} sm:max-w-xs`} />;
}

export function MediaGrid({ items, onOpen }: { items: MediaItem[]; onOpen: (m: MediaItem) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => onOpen(m)} aria-label={`${m.fileName}: ${m.altText}`}
            className="grid w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left hover:border-brand-bright focus-visible:border-brand-bright">
            <img src={fileUrl(m)} alt="" loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-contain" />
            <span className="grid gap-0.5 border-t border-slate-100 px-2.5 py-2">
              <span className="truncate text-xs font-semibold">{m.fileName}</span>
              <span className="truncate text-[11px] text-slate-500">{m.usedIn.length ? `Used in ${m.usedIn.length} ${m.usedIn.length === 1 ? "place" : "places"}` : "Not used yet"}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MediaPager({ data, onPage }: { data: MediaPage; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (last === 1) return null;
  return (
    <nav aria-label="Image pages" className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button type="button" disabled={data.page === 1} onClick={() => onPage(data.page - 1)} className={plainBtn}>Previous</button>
      <span className="text-slate-500">Page {data.page} of {last}</span>
      <button type="button" disabled={data.page >= last} onClick={() => onPage(data.page + 1)} className={plainBtn}>Next</button>
    </nav>
  );
}

/** Choose a file (or drop one) and describe it. Alt text is asked for here, so no image enters the library without it. */
export function UploadForm({ onDone, onCancel }: { onDone: (m: MediaItem) => void; onCancel?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [alt, setAlt] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f: File | undefined) {
    if (!f) return;
    setError("");
    setErrors({});
    if (f.size > MAX_BYTES) return setErrors({ file: "This image is too large (10 MB at most)." });
    if (!TYPES.split(",").includes(f.type)) return setErrors({ file: "Choose a JPG, PNG or WebP image." });
    setFile(f);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setErrors({ file: "Choose an image." });
    if (!alt.trim()) return setErrors({ alt: "Describe the image: alt text is required." });
    setBusy(true);
    setError("");
    setErrors({});
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    try {
      const r = await api<{ media: MediaItem }>("/media", { method: "POST", form });
      setFile(null);
      setAlt("");
      onDone(r.media);
    } catch (err) {
      const fields = err instanceof ApiError ? (err.body as { errors?: Errors } | null)?.errors : undefined;
      if (fields) setErrors(fields);
      else setError(err instanceof Error ? err.message : "Couldn't upload the image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={`grid min-h-36 place-items-center overflow-hidden rounded-lg border border-dashed text-center ${over ? "border-brand-bright bg-brand-soft" : "border-slate-300 bg-slate-50"}`}>
        {preview
          ? <img src={preview} alt="" className="max-h-44 w-full object-contain" />
          : <p className="p-3 text-xs text-slate-500">Drop an image here, or use the button.<br />JPG, PNG or WebP, up to 10 MB.</p>}
      </div>
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <input ref={input} type="file" accept={TYPES} hidden aria-label="Image file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => input.current?.click()} className={plainBtn}>{file ? "Choose another" : "Choose image"}</button>
            {file && <span className="min-w-0 truncate text-xs text-slate-500">{file.name} · {fileSize(file.size)}</span>}
          </div>
          <FieldError id="upload-file-err" msg={errors.file} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="upload-alt" className="text-xs font-semibold">Alt text</label>
          <input id="upload-alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} aria-invalid={!!errors.alt} aria-describedby="upload-alt-help" className={inputCls} />
          <span id="upload-alt-help" className="text-[11px] text-slate-500">What the image shows, for people who can't see it and for search engines.</span>
          <FieldError id="upload-alt-err" msg={errors.alt} />
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={saveBtn}>{busy ? "Uploading…" : "Upload"}</button>
          {onCancel && <button type="button" onClick={onCancel} className={plainBtn}>Cancel</button>}
        </div>
      </div>
    </form>
  );
}

export function MediaPicker({ onPick, onClose }: { onPick: (m: MediaItem) => void; onClose: () => void }) {
  const list = useMediaList();
  const [uploading, setUploading] = useState(false);
  return (
    <Modal title="Choose an image" onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MediaSearch value={list.query} onChange={list.setQuery} />
        {!uploading && <button type="button" onClick={() => setUploading(true)} className={saveBtn}>Upload new</button>}
      </div>
      {uploading && <div className="mb-4"><UploadForm onDone={onPick} onCancel={() => setUploading(false)} /></div>}
      {list.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{list.error}</p>}
      {!list.data && !list.error && <p className="text-sm text-slate-500">Loading…</p>}
      {list.data?.items.length === 0 && <p className="text-sm text-slate-500">{list.query ? "No images match this search." : "The library is empty. Upload the first image."}</p>}
      {list.data && <MediaGrid items={list.data.items} onOpen={onPick} />}
      {list.data && <MediaPager data={list.data} onPage={list.setPage} />}
    </Modal>
  );
}
