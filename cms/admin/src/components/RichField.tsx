// A text field that shows its formatted text and turns into the text editor when clicked or focused. Only one is open at a
// time, so a page with 40 fields doesn't start 40 editors.
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { sanitizeText } from "@liveaccess/shared";

const RichTextEditor = lazy(() => import("./RichTextEditor.tsx"));

let openId: string | null = null;
const listeners = new Set<() => void>();
const setOpen = (id: string | null) => {
  openId = id;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// Never the admin page's own document: parsing HTML there can run it.
const inert = document.implementation.createHTMLDocument("");

/** The stored text, cleaned again and made inert for showing: no classes (they'd pick up the admin's styles) and no live links. */
function display(html: string) {
  const box = inert.createElement("div");
  box.innerHTML = sanitizeText(html, inert);
  box.querySelectorAll("[class], [href], [target], [rel]").forEach((el) => {
    for (const a of ["class", "href", "target", "rel"]) el.removeAttribute(a);
  });
  return box.innerHTML;
}

type Props = {
  id: string;
  value: string;
  label: string;
  onChange: (html: string) => void;
  /** Called when the field opens (the preview highlights it). */
  onOpen?: () => void;
  className?: string;
};

export function RichField({ id, value, label, onChange, onOpen, className = "" }: Props) {
  const open = useSyncExternalStore(subscribe, () => openId === id);
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  // A field that goes away (a block removed, a page left) mustn't stay the open one.
  useEffect(() => () => { if (openId === id) setOpen(null); }, [id]);

  const start = () => {
    if (open) return;
    setOpen(id);
    onOpen?.();
  };
  const closed = (
    <div id={open ? undefined : id} role="textbox" aria-label={label} aria-multiline="false" tabIndex={0} title="Click to edit"
      onFocus={start} onClick={start}
      className={`min-h-[2.375rem] w-full cursor-text rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-words hover:border-slate-300 [&_a]:underline ${className}`}
      dangerouslySetInnerHTML={{ __html: display(shown) || `<span class="text-slate-400">Empty</span>` }} />
  );
  if (!open) return closed;
  return (
    <Suspense fallback={closed}>
      <div className="la-text-editor">
        <RichTextEditor id={id} mode="text" label={label} value={shown} autoFocus onChange={(html) => { setShown(html); onChange(html); }} />
      </div>
    </Suspense>
  );
}
