// Content blocks of a guide: the types the site already styles, each editable, movable and removable.
import type { Block } from "@liveaccess/shared";
import { FieldError, iconBtn, inputCls, type Errors } from "./form.tsx";

type Props = { blocks: Block[]; errors: Errors; onChange: (blocks: Block[]) => void };

const NEW: Record<string, () => Block> = {
  "Heading": () => ({ type: "heading", level: 2, text: "" }),
  "Paragraph": () => ({ type: "paragraph", html: "" }),
  "List": () => ({ type: "list", style: "bullet", items: [""] }),
  "Safety note": () => ({ type: "callout", variant: "safety", title: "Safety first.", text: "" }),
  "Disclaimer": () => ({ type: "callout", variant: "disclaimer", title: "", text: "" })
};
const label = (b: Block) => b.type === "heading" ? `Heading (H${b.level})` : b.type === "list" ? (b.style === "number" ? "Numbered list" : "Bullet list")
  : b.type === "callout" ? (b.variant === "safety" ? "Safety note" : "Disclaimer") : b.type === "paragraph" ? "Paragraph" : b.type;
const tagsHelp = "Allowed: <strong>bold</strong>, <em>highlight</em>, <a href=\"…\">link</a>.";

function BlockFields({ b, id, set }: { b: Block; id: string; set: (b: Block) => void }) {
  if (b.type === "heading") {
    return (
      <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
        <select aria-label="Heading level" value={b.level} onChange={(e) => set({ ...b, level: e.target.value === "3" ? 3 : 2 })} className={inputCls}>
          <option value={2}>H2 section</option><option value={3}>H3 sub</option>
        </select>
        <input id={id} aria-label="Heading text" value={b.text} maxLength={200} onChange={(e) => set({ ...b, text: e.target.value })} className={`${inputCls} font-semibold`} />
      </div>
    );
  }
  if (b.type === "paragraph") {
    return (
      <div className="grid gap-1">
        <textarea id={id} aria-label="Paragraph text" value={b.html} rows={Math.min(8, Math.max(2, Math.ceil(b.html.length / 80)))} maxLength={3000}
          onChange={(e) => set({ ...b, html: e.target.value })} className={`${inputCls} resize-y`} />
        <span className="text-[11px] text-slate-500">{tagsHelp}</span>
      </div>
    );
  }
  if (b.type === "list") {
    return (
      <div className="grid gap-2">
        <select aria-label="List style" value={b.style} onChange={(e) => set({ ...b, style: e.target.value === "number" ? "number" : "bullet" })} className={`${inputCls} w-44`}>
          <option value="bullet">Bullets</option><option value="number">Numbered (steps)</option>
        </select>
        {b.items.map((item, j) => (
          <div key={j} className="flex items-start gap-2">
            <span className="mt-2 w-5 text-right text-xs text-slate-400">{b.style === "number" ? `${j + 1}.` : "•"}</span>
            <textarea id={j === 0 ? id : undefined} aria-label={`Item ${j + 1}`} value={item} rows={Math.min(5, Math.max(1, Math.ceil(item.length / 80)))} maxLength={3000}
              onChange={(e) => set({ ...b, items: b.items.map((x, k) => (k === j ? e.target.value : x)) })} className={`${inputCls} resize-y`} />
            <button type="button" className={iconBtn} aria-label={`Remove item ${j + 1}`} title="Remove item" disabled={b.items.length === 1}
              onClick={() => set({ ...b, items: b.items.filter((_, k) => k !== j) })}>✕</button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button type="button" disabled={b.items.length >= 50} onClick={() => set({ ...b, items: [...b.items, ""] })}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:border-slate-300 disabled:opacity-40">+ Add item</button>
          <span className="text-[11px] text-slate-500">{tagsHelp}</span>
        </div>
      </div>
    );
  }
  if (b.type === "callout") {
    return (
      <div className="grid gap-2">
        {b.variant === "safety" && <input aria-label="Note title (bold)" value={b.title} maxLength={80} onChange={(e) => set({ ...b, title: e.target.value })} className={`${inputCls} font-semibold`} />}
        <textarea id={id} aria-label="Note text" value={b.text} rows={3} maxLength={2000} onChange={(e) => set({ ...b, text: e.target.value })} className={`${inputCls} resize-y`} />
      </div>
    );
  }
  return <p className="text-sm text-slate-500">This block type can't be edited here yet.</p>;
}

export function BlockEditor({ blocks, errors, onChange }: Props) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {blocks.map((b, i) => {
        const tone = b.type === "callout" ? (b.variant === "safety" ? "border-amber-300 bg-amber-50/50" : "border-slate-300 bg-slate-50") : b.type === "heading" ? "border-slate-300 bg-white" : "border-slate-200 bg-white";
        return (
          // Index keys: blocks have no id of their own, and inputs are controlled, so values follow their block.
          <div key={i} data-block={i} className={`grid gap-2 rounded-lg border p-3 ${tone}`}>
            <div className="flex items-center gap-1.5">
              <span className="flex-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{label(b)}</span>
              <button type="button" className={iconBtn} aria-label={`Move block ${i + 1} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className={iconBtn} aria-label={`Move block ${i + 1} down`} title="Move down" disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className={iconBtn} aria-label={`Remove block ${i + 1}`} title="Remove" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>✕</button>
            </div>
            <BlockFields b={b} id={`block-${i}`} set={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} />
            <FieldError id={`block-${i}-err`} msg={errors[`blocks.${i}`]} />
          </div>
        );
      })}
      <FieldError id="blocks-err" msg={errors.blocks} />
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 p-3">
        <span className="text-xs font-semibold text-slate-500">Add block:</span>
        {Object.entries(NEW).map(([name, make]) => (
          <button key={name} type="button" disabled={blocks.length >= 200} onClick={() => onChange([...blocks, make()])}
            className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold hover:border-slate-300 disabled:opacity-40">+ {name}</button>
        ))}
      </div>
    </div>
  );
}
