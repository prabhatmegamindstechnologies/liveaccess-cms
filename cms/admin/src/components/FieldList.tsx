// Fields read from the real page, grouped by section; repeating items get move / remove / add controls.
import { useEffect, useState, type ReactNode } from "react";
import type { Field } from "@liveaccess/shared";
import { fromAdmin } from "../lib/media.ts";
import { PREVIEW_BASE } from "../lib/preview.ts";

type ItemOp = "up" | "down" | "remove" | "add";
type Props = {
  fields: Field[];
  tick: number;
  onChange: (f: Field, value: string) => void;
  onAlt: (f: Field, alt: string) => void;
  onImage: (f: Field) => void;
  onItem: (op: ItemOp, f: Field) => void;
  onFocusField: (f: Field) => void;
  /** Set when text is clicked in the preview; `n` changes on every click. */
  reveal?: { id: number; n: number } | null;
};

const plain = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const sameKind = (a: Element | null, b: Element | null) => !!a && !!b && a.parentElement === b.parentElement && a.tagName === b.tagName && a.className === b.className;
const inputCls = "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-bright focus:bg-white";

function itemLabel(fields: Field[], i: number) {
  for (let j = i; j < fields.length && fields[j]!.item === fields[i]!.item; j++) {
    const f = fields[j]!;
    if (f.type !== "img" && plain(f.value).length > 2) return plain(f.value).slice(0, 60);
  }
  return "Item";
}

function wrapSelection(id: string, tag: "strong" | "em", f: Field, onChange: Props["onChange"]) {
  const ta = document.getElementById(id) as HTMLTextAreaElement | null;
  if (!ta || ta.selectionStart === ta.selectionEnd) return;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  ta.value = `${value.slice(0, s)}<${tag}>${value.slice(s, e)}</${tag}>${value.slice(e)}`;
  onChange(f, ta.value);
  ta.focus();
}

function FieldInput({ f, tick, onChange, onAlt, onImage, onFocusField }: { f: Field } & Omit<Props, "fields" | "onItem">) {
  const id = `fld-${f.id}`;
  if (f.type === "img") {
    const src = f.el.getAttribute("src") ?? "";
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold">Image</span>
        <div className="flex items-center gap-3">
          <img src={/^(https?:|data:|\/)/.test(src) ? src : PREVIEW_BASE + src} alt="" className="h-16 w-24 rounded-md border border-slate-200 bg-slate-100 object-cover object-top" />
          <div className="grid gap-1">
            <button type="button" onClick={() => onImage(f)} className="w-fit rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold hover:border-slate-300">Change image</button>
            <span className="font-mono text-[11px] break-all text-slate-500">{fromAdmin(src)}</span>
          </div>
        </div>
        <label htmlFor={id} className="text-xs font-semibold">Alt text</label>
        <input id={id} key={`${tick}-${f.id}`} defaultValue={f.el.getAttribute("alt") ?? ""} className={inputCls}
          onFocus={() => onFocusField(f)} onChange={(e) => onAlt(f, e.target.value)} />
      </div>
    );
  }
  const long = f.value.length > 70 || /</.test(f.value);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">{f.label}</label>
      {long ? (
        <>
          {f.type === "text" && (
            <span className="flex gap-1">
              <button type="button" className="rounded border border-slate-200 px-2 text-xs font-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(id, "strong", f, onChange)} aria-label="Bold">B</button>
              <button type="button" className="rounded border border-slate-200 px-2 text-xs italic" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection(id, "em", f, onChange)} aria-label="Highlight">I</button>
            </span>
          )}
          <textarea id={id} key={`${tick}-${f.id}`} defaultValue={f.value} rows={Math.min(8, Math.max(2, Math.ceil(f.value.length / 60)))}
            className={`${inputCls} resize-y`} onFocus={() => onFocusField(f)} onChange={(e) => onChange(f, e.target.value)} />
          {/</.test(f.value) && <span className="text-[11px] text-slate-500">Keep the tags: &lt;em&gt; = highlighted words, &lt;strong&gt; = bold, &lt;a&gt; = link.</span>}
        </>
      ) : (
        <input id={id} key={`${tick}-${f.id}`} defaultValue={f.value} className={inputCls} onFocus={() => onFocusField(f)} onChange={(e) => onChange(f, e.target.value)} />
      )}
    </div>
  );
}

export function FieldList(props: Props) {
  const { fields, onItem, reveal } = props;
  const [closed, setClosed] = useState<Set<number>>(() => new Set());

  const groups: { root: Element; title: string; idx: number[] }[] = [];
  fields.forEach((f, i) => {
    const g = groups.at(-1);
    if (g && g.root === f.root) g.idx.push(i);
    else groups.push({ root: f.root, title: f.section, idx: [i] });
  });

  // Preview click → open the section that holds the field, then focus the field.
  useEffect(() => {
    if (!reveal) return;
    const gi = groups.findIndex((g) => g.idx.some((i) => fields[i]!.id === reveal.id));
    if (gi < 0) return;
    setClosed((s) => {
      if (!s.has(gi)) return s;
      const next = new Set(s);
      next.delete(gi);
      return next;
    });
    requestAnimationFrame(() => {
      const input = document.getElementById(`fld-${reveal.id}`) as HTMLInputElement | null;
      input?.scrollIntoView({ block: "center" });
      input?.focus({ preventScroll: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  if (!fields.length) return <p className="text-sm text-slate-500">Loading the page…</p>;

  const toggle = (gi: number) => setClosed((s) => {
    const next = new Set(s);
    if (next.has(gi)) next.delete(gi); else next.add(gi);
    return next;
  });

  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setClosed(new Set(groups.map((_, i) => i)))} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:border-slate-300">Collapse all</button>
        <button type="button" onClick={() => setClosed(new Set())} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:border-slate-300">Expand all</button>
      </div>
      {groups.map((g, gi) => {
        const out: ReactNode[] = [];
        let k = 0;
        while (k < g.idx.length) {
          const i = g.idx[k]!, f = fields[i]!;
          if (!f.item) {
            out.push(<FieldInput key={f.id} f={f} {...props} />);
            k++;
            continue;
          }
          const run: number[] = [];
          while (k < g.idx.length && fields[g.idx[k]!]!.item === f.item) run.push(g.idx[k++]!);
          const next = k < g.idx.length ? fields[g.idx[k]!]!.item : null;
          out.push(
            <div key={`item-${f.id}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{itemLabel(fields, i)}</span>
                {([["up", "↑", "Move up"], ["down", "↓", "Move down"], ["remove", "✕", "Remove"]] as const).map(([op, sym, label]) => (
                  <button key={op} type="button" title={label} aria-label={label} onClick={() => onItem(op, f)}
                    className="grid size-7 place-items-center rounded-md border border-slate-200 bg-white text-xs text-slate-500 hover:text-slate-900">{sym}</button>
                ))}
              </div>
              {run.map((j) => <FieldInput key={fields[j]!.id} f={fields[j]!} {...props} />)}
            </div>
          );
          if (!sameKind(f.item, next)) {
            out.push(
              <div key={`add-${f.id}`}>
                <button type="button" onClick={() => onItem("add", fields[run.at(-1)!]!)} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:border-slate-300">+ Add another</button>
              </div>
            );
          }
        }
        const open = !closed.has(gi);
        const bodyId = `section-${gi}`;
        return (
          <section key={`${g.idx[0]}`} data-section={gi} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <button type="button" onClick={() => toggle(gi)} aria-expanded={open} aria-controls={bodyId}
                className="flex w-full items-center gap-2 text-left uppercase hover:text-slate-800">
                <span aria-hidden="true" className={`inline-block w-3 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>▸</span>
                <span className="min-w-0 flex-1">{g.title}</span>
                <span className="font-mono text-[11px] font-medium normal-case">{g.idx.length} fields</span>
              </button>
            </h2>
            {/* Collapsed sections stay in the DOM (hidden), so their inputs keep their values and the preview link. */}
            <div id={bodyId} hidden={!open} className="grid gap-3">{out}</div>
          </section>
        );
      })}
    </div>
  );
}
