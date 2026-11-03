// Form pieces shared by the Menus and SEO screens.
import { useEffect, useMemo } from "react";

export type LinkOption = { group: string; label: string; href: string };
export type Errors = Record<string, string>;

export const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/20 focus:outline-none aria-[invalid=true]:border-red-500";
export const iconBtn = "grid size-8 place-items-center rounded-md border border-slate-200 bg-white text-sm text-slate-500 hover:text-slate-900 disabled:opacity-35";
export const saveBtn = "rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a8370a] disabled:opacity-50";

const EXTERNAL = "__external";

export function FieldError({ id, msg }: { id: string; msg?: string }) {
  return msg ? <span id={id} className="text-xs font-medium text-red-600">{msg}</span> : null;
}

/** Pick a site page from a grouped list, or type a full https:// address. */
export function LinkPicker({ id, label = "Link", value, options, error, onChange }: { id: string; label?: string; value: string; options: LinkOption[]; error?: string; onChange: (href: string) => void }) {
  const known = options.some((o) => o.href === value);
  // Derived from the value, so it stays right when rows are moved.
  const external = value !== "" && !known;
  const groups = useMemo(() => [...new Set(options.map((o) => o.group))], [options]);
  const errId = `${id}-err`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold">{label}</label>
      <select id={id} value={external ? EXTERNAL : known ? value : ""} aria-invalid={!!error && !external} aria-describedby={error && !external ? errId : undefined}
        className={inputCls}
        onChange={(e) => onChange(e.target.value === EXTERNAL ? "https://" : e.target.value)}>
        <option value="" disabled>Choose a page…</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => <option key={o.href} value={o.href}>{o.label}</option>)}
          </optgroup>
        ))}
        <option value={EXTERNAL}>External link (https://…)</option>
      </select>
      {external && (
        <input aria-label="External link address" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://example.com/"
          aria-invalid={!!error} aria-describedby={error ? errId : undefined} className={`${inputCls} font-mono`} />
      )}
      <FieldError id={errId} msg={error} />
    </div>
  );
}

/** Saved / unsaved pill. */
export function SavedPill({ dirty, savedAt }: { dirty: boolean; savedAt?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold">
      <i aria-hidden="true" className={`size-2 rounded-full ${dirty ? "bg-amber-500" : "bg-green-600"}`} />
      {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "All changes saved"}
    </span>
  );
}

/** Warn before closing the tab, or following a link inside the admin, with unsaved changes. */
export function useUnsavedWarning(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && !window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty, message]);
}
