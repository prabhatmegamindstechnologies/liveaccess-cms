// Small shared pieces: page header, chips and the save status pill.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { SaveState } from "../lib/autosave.ts";

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 && " / "}
          {it.to ? <Link to={it.to} className="underline decoration-slate-300 underline-offset-2 hover:text-brand">{it.label}</Link> : <b className="font-semibold text-slate-800">{it.label}</b>}
        </span>
      ))}
    </nav>
  );
}

export function Chip({ tone, children }: { tone: "good" | "draft" | "changes"; children: ReactNode }) {
  const cls = { good: "bg-green-50 text-green-700", draft: "bg-slate-100 text-slate-600", changes: "bg-brand-soft text-brand" }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${cls}`}>{children}</span>;
}

/** An outline icon (a 24×24 path). The button or link around it carries the label. */
export function LineIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
      <path d={d} />
    </svg>
  );
}

/** The look of an icon-only action in a list row. */
export const iconBtn = "inline-grid size-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-brand";

export const PENCIL = "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z";
export const KEY = "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z";

/** The pencil at the end of a list row. Rows open on click too, so this stops the click reaching the row. */
export function EditLink({ to, name }: { to: string; name: string }) {
  return (
    <Link to={to} onClick={(e) => e.stopPropagation()} title="Edit" aria-label={`Edit ${name}`} className={iconBtn}>
      <LineIcon d={PENCIL} />
    </Link>
  );
}

export function SaveStatus({ state }: { state: SaveState }) {
  const time = state.savedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const view = {
    idle: { dot: "bg-green-600", text: "All changes saved" },
    pending: { dot: "bg-amber-500", text: "Unsaved changes…" },
    saving: { dot: "bg-amber-500 animate-pulse", text: "Saving…" },
    saved: { dot: "bg-green-600", text: `Saved ${time ?? ""}` },
    error: { dot: "bg-red-600", text: "Couldn't save — retrying" },
    conflict: { dot: "bg-red-600", text: "Not saved" }
  }[state.status];
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold">
      <i className={`size-2 rounded-full ${view.dot}`} aria-hidden="true" />{view.text}
    </span>
  );
}
