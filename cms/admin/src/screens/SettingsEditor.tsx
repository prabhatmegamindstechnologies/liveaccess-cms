// Site settings: values used across the whole site. Saved as a draft by a Super Admin; Editors can only read them.
import { useEffect, useState, type ReactNode } from "react";
import type { SiteSettings } from "@liveaccess/shared";
import { api, ApiError } from "../lib/api.ts";
import { Breadcrumb } from "../components/ui.tsx";
import { FieldError, inputCls, SavedPill, saveBtn, useUnsavedWarning, type Errors } from "../components/form.tsx";

type Data = { value: SiteSettings; version: number; updatedAt: string | null; updatedBy: string | null; canEdit: boolean };
type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; text?: string };

export function SettingsEditor() {
  const [data, setData] = useState<Data | null>(null);
  const [value, setValue] = useState<SiteSettings | null>(null);
  const [saved, setSaved] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api<Data>("/settings").then((d) => { setData(d); setValue(d.value); setSaved(JSON.stringify(d.value)); }).catch((e) => setLoadError(e.message));
  }, []);

  const dirty = !!value && JSON.stringify(value) !== saved;
  useUnsavedWarning(dirty, "You have unsaved site settings. Leave without saving?");

  async function save() {
    if (!data || !value) return;
    setStatus({ kind: "saving" });
    setErrors({});
    try {
      const r = await api<{ version: number; updatedAt: string; value: SiteSettings }>("/settings", { method: "PUT", json: { baseVersion: data.version, value } });
      setData({ ...data, version: r.version, updatedAt: r.updatedAt });
      setValue(r.value);
      setSaved(JSON.stringify(r.value));
      setStatus({ kind: "saved", text: new Date(r.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors((e.body as { errors?: Errors } | null)?.errors ?? {});
        setStatus({ kind: "error", text: "Fix what's marked in red, then save again." });
      } else if (e instanceof ApiError && e.status === 409) setStatus({ kind: "conflict", text: e.message });
      else setStatus({ kind: "error", text: e instanceof Error ? e.message : "Couldn't save." });
    }
  }

  if (loadError) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  if (!data || !value) return <p className="text-sm text-slate-500">Loading site settings…</p>;

  const ro = !data.canEdit;
  const field = (key: keyof SiteSettings, label: string, opts: { type?: string; help?: ReactNode; textarea?: boolean; placeholder?: string; mono?: boolean } = {}) => {
    const id = `s-${key}`, err = errors[key];
    const common = {
      id, value: value[key], readOnly: ro, placeholder: opts.placeholder,
      "aria-invalid": !!err, "aria-describedby": [opts.help ? `${id}-help` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined,
      className: `${inputCls} ${opts.mono ? "font-mono" : ""} ${ro ? "bg-slate-50 text-slate-600" : ""}`
    };
    const change = (v: string) => setValue({ ...value, [key]: v });
    return (
      <div className="grid gap-1.5">
        <label htmlFor={id} className="text-xs font-semibold">{label}</label>
        {opts.textarea
          ? <textarea {...common} rows={2} onChange={(e) => change(e.target.value)} className={`${common.className} resize-y`} />
          : <input {...common} type={opts.type ?? "text"} onChange={(e) => change(e.target.value)} />}
        {opts.help && <span id={`${id}-help`} className="text-xs text-slate-500">{opts.help}</span>}
        <FieldError id={`${id}-err`} msg={err} />
      </div>
    );
  };
  const card = (title: string, children: ReactNode) => (
    <section className="grid content-start gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {children}
    </section>
  );

  return (
    <div className="mx-auto max-w-[1400px]">
      <Breadcrumb items={[{ label: "Website" }, { label: "Site settings" }]} />
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Site settings</h1>
        <span className="flex-1" />
        {!ro && (
          <>
            <SavedPill dirty={dirty} savedAt={status.kind === "saved" ? status.text : undefined} />
            <button type="button" onClick={save} disabled={!dirty || status.kind === "saving"} className={saveBtn}>
              {status.kind === "saving" ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>
      <p className="mb-5 text-sm text-slate-500">
        Values used across the whole site. Change once, updated everywhere when published.
        {data.updatedBy && data.updatedAt && <> Last saved by {data.updatedBy}, {new Date(data.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.</>}
      </p>

      {ro && <p role="note" className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-900">Only a Super Admin can change site settings. You can see the current values here.</p>}
      {status.kind === "conflict" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="flex-1">{status.text} Your changes were not saved.</span>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white">Reload</button>
        </div>
      )}
      {status.kind === "error" && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{status.text}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {card("General", <>
          {field("siteName", "Site name", { help: "Shown by social networks next to shared links." })}
          {field("tagline", "Footer tagline", { textarea: true, help: "The line under the site name in the footer of every page." })}
        </>)}
        {card("App links", <>
          {field("appStore", "App Store URL", { type: "url", mono: true })}
          {field("playStore", "Google Play URL", { type: "url", mono: true, help: "Used by every store badge, the QR redirect and the footer. Each page keeps its own tracking tag on the Google Play link." })}
        </>)}
        {card("Contact", <>
          {field("email", "Public contact email", { type: "email", help: "Shown on the site and used in its email links." })}
          {field("notifyEmail", "Send new contact messages to", { type: "email", placeholder: "Optional", help: "Saved now. Email alerts start once an email service is added." })}
        </>)}
        {card("Analytics", <>
          {field("ga4", "Google Analytics 4 ID", { mono: true, help: "Required: the GA4 tag stays on every page. Change it only if the property changes." })}
          {field("gtm", "Google Tag Manager ID (optional)", { mono: true, placeholder: "GTM-XXXXXXX", help: "Added alongside GA4, never instead of it." })}
        </>)}
      </div>
    </div>
  );
}
