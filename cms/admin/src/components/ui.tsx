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
