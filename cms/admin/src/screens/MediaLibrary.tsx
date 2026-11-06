// The Media library: upload images, keep their alt text up to date, see where each one is used, replace or delete them.
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { fileSize, fileUrl, type MediaItem } from "../lib/media.ts";
import { Breadcrumb, Chip } from "../components/ui.tsx";
import { FieldError, inputCls, saveBtn } from "../components/form.tsx";
import { MediaGrid, MediaPager, MediaSearch, Modal, plainBtn, UploadForm, useMediaList } from "../components/MediaPicker.tsx";

function Details({ item, onChange, onDeleted, onClose }: { item: MediaItem; onChange: (m: MediaItem) => void; onDeleted: () => void; onClose: () => void }) {
  const [alt, setAlt] = useState(item.altText);
  const [altError, setAltError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const used = item.usedIn.length > 0;

  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    setError("");
    setAltError("");
    setSaved(false);
    try {
      await work();
    } catch (e) {
      const field = e instanceof ApiError ? (e.body as { errors?: { altText?: string } } | null)?.errors?.altText : undefined;
      if (field) setAltError(field);
      else setError(e instanceof Error ? e.message : failed);
    } finally {
      setBusy(false);
    }
  };

  const saveAlt = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const r = await api<{ media: MediaItem }>(`/media/${item.id}`, { method: "PATCH", json: { altText: alt } });
      setAlt(r.media.altText);
      setSaved(true);
      onChange(r.media);
    }, "Couldn't save the alt text.");
  };

  const replace = (file: File | undefined) => {
    if (!file) return;
    if (used && !window.confirm(`This changes the picture everywhere it's used (${item.usedIn.length} ${item.usedIn.length === 1 ? "place" : "places"}). Replace it?`)) return;
    const form = new FormData();
    form.set("file", file);
    return run(async () => onChange((await api<{ media: MediaItem }>(`/media/${item.id}/replace`, { method: "POST", form })).media), "Couldn't replace the image.");
  };

  const remove = () => {
    if (!window.confirm(`Delete ${item.fileName}? This can't be undone.`)) return;
    return run(async () => {
      await api(`/media/${item.id}`, { method: "DELETE" });
      onDeleted();
    }, "Couldn't delete the image.");
  };

  return (
    <Modal title={item.fileName} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <img src={fileUrl(item)} alt={item.altText} className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-slate-100 object-contain" />
          <p className="text-xs text-slate-500">{item.width} × {item.height} px · {fileSize(item.bytes)} · Added {new Date(item.createdAt).toLocaleDateString([], { dateStyle: "medium" })}</p>
        </div>
        <div className="grid content-start gap-5">
          <form onSubmit={saveAlt} className="grid gap-1.5">
            <label htmlFor="media-alt" className="text-xs font-semibold">Alt text</label>
            <textarea id="media-alt" value={alt} maxLength={300} rows={3} onChange={(e) => { setAlt(e.target.value); setSaved(false); }} aria-invalid={!!altError} className={`${inputCls} resize-y`} />
            <FieldError id="media-alt-err" msg={altError} />
            <span className="text-[11px] text-slate-500">Used when this image is next chosen. Places already using it keep their own alt text.</span>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy || alt.trim() === item.altText} className={saveBtn}>Save alt text</button>
              {saved && <span role="status" className="text-sm font-semibold text-green-700">Saved</span>}
            </div>
          </form>

          <section className="grid gap-2">
            <h3 className="text-xs font-semibold">Where it's used</h3>
            {used
              ? <ul className="grid gap-1.5">{item.usedIn.map((u) => (
                  <li key={`${u.link}`} className="flex items-center gap-2 text-sm">
                    <Link to={u.link} className="min-w-0 truncate font-semibold text-brand hover:underline">{u.title}</Link>
                    {u.live ? <Chip tone="good">Live</Chip> : <Chip tone="draft">Draft</Chip>}
                  </li>
                ))}</ul>
              : <p className="text-sm text-slate-500">Not used yet.</p>}
          </section>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Replacement image" onChange={(e) => { void replace(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className={plainBtn}>Replace image</button>
              <button type="button" disabled={busy || used} onClick={() => void remove()} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</button>
            </div>
            {used && <p className="text-[11px] text-slate-500">An image in use can't be deleted. Remove it from the places above first.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function MediaLibrary() {
  const list = useMediaList();
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<MediaItem | null>(null);
  const empty = list.data?.total === 0 && !list.query;
  const showUpload = uploading || empty;

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Media library" }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Media library</h1>
          <p className="mt-1 text-sm text-slate-500">Upload images, add alt text and reuse them across the site. They reach the live site when a page that uses them is published.</p>
        </div>
        {!showUpload && <button type="button" onClick={() => setUploading(true)} className={saveBtn}>Upload image</button>}
      </div>

      {showUpload && <div className="mb-5"><UploadForm onDone={() => { setUploading(false); void list.reload(); }} onCancel={empty ? undefined : () => setUploading(false)} /></div>}
      {!empty && <div className="mb-4"><MediaSearch value={list.query} onChange={list.setQuery} /></div>}
      {list.error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{list.error}</p>}
      {!list.data && !list.error && <p className="text-sm text-slate-500">Loading…</p>}
      {list.data?.items.length === 0 && list.query && <p className="text-sm text-slate-500">No images match this search.</p>}
      {list.data && <MediaGrid items={list.data.items} onOpen={setOpen} />}
      {list.data && <MediaPager data={list.data} onPage={list.setPage} />}

      {open && (
        <Details key={open.id} item={open} onClose={() => setOpen(null)}
          onChange={(m) => { setOpen(m); void list.reload(); }}
          onDeleted={() => { setOpen(null); void list.reload(); }} />
      )}
    </div>
  );
}
