// The real page, scaled to fit, in a sandboxed iframe (no scripts run). Click text → its field.
import { useCallback, useEffect, useRef, useState } from "react";

type Props = { srcDoc: string; url: string; visible: boolean; onReady: (doc: Document) => void; onPick: (fieldId: number) => void };

export function LivePreview({ srcDoc, url, visible, onReady, onPick }: Props) {
  const [mode, setMode] = useState<"desktop" | "mobile">("desktop");
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  const fit = useCallback(() => {
    const b = box.current, f = frame.current;
    if (!b || !f || !b.clientWidth) return;
    const inner = mode === "mobile" ? 390 : 1280;
    const scale = Math.min(1, b.clientWidth / inner);
    f.style.width = `${inner}px`;
    f.style.height = `${Math.ceil(b.clientHeight / scale)}px`;
    f.style.transform = `scale(${scale})`;
    f.style.transformOrigin = "0 0";
    f.style.left = `${Math.max(0, (b.clientWidth - inner * scale) / 2)}px`;
  }, [mode]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [fit, visible]);

  function handleLoad() {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    doc.addEventListener("click", (e) => {
      e.preventDefault();
      const t = (e.target as Element | null)?.closest?.("[data-cms-f]");
      if (t) pick.current(Number(t.getAttribute("data-cms-f")));
    }, true);
    doc.addEventListener("submit", (e) => e.preventDefault(), true);
    fit();
    onReady(doc);
  }

  return (
    // Narrow screens: sticky below the fields. Wide screens: fills the editor's right column (see lib/layout.ts).
    <div className={visible ? "sticky top-4 grid gap-2 xl:static xl:flex xl:h-full xl:flex-col" : "hidden"}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>Live preview</span>
        <span className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2.5 py-1 font-mono">liveaccess.ai{url}</span>
        <span className="inline-flex overflow-hidden rounded-md border border-slate-200 bg-white" role="group" aria-label="Preview size">
          {(["desktop", "mobile"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`px-2.5 py-1 font-semibold capitalize ${mode === m ? "bg-navy text-white" : "text-slate-500"}`}>{m}</button>
          ))}
        </span>
      </div>
      <div ref={box} className="relative h-[calc(100vh-15rem)] min-h-[480px] overflow-hidden rounded-xl border border-slate-200 bg-slate-200 xl:h-auto xl:min-h-0 xl:flex-1">
        <iframe ref={frame} title={`Preview of liveaccess.ai${url}`} sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={handleLoad}
          className="absolute top-0 left-0 block border-0 bg-white" />
      </div>
      <p className="text-xs text-slate-500">The real page with its own CSS (scripts don't run here). Click any text to jump to its field.</p>
    </div>
  );
}
