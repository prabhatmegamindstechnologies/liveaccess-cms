// Publish centre: publish the site to the website (one commit on its GitHub branch), and, on your own computer, a local preview.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { Breadcrumb } from "../components/ui.tsx";

type Skipped = { kind: "page" | "guide" | "area"; id: number | string; title: string; reason: string; live: boolean };
type Build = { builtAt: string; counts: { pages: number; guides: number; areas: number; files: number }; skipped: Skipped[]; warnings: string[] };
type Preview = { running: boolean; last: Build | null; url: string };

const editor = (s: Skipped) => (s.kind === "page" ? `/pages/${s.id}` : `/${s.kind}s/${s.id}`);
const when = (d: string) => new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

type PastPublish = { id: number; status: "running" | "done" | "failed"; startedAt: string; by: string | null; files: string[]; commitUrl: string | null; error: string | null };
type LiveState = { configured: boolean; missing: string[]; repo: string | null; branch: string | null; publishes: PastPublish[] };
type Outcome = { result: Build; files: string[]; commit: { sha: string; url: string } | null };

function SkippedList({ skipped, title }: { skipped: Skipped[]; title: string }) {
  if (!skipped.length) return null;
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {skipped.map((s) => (
          <li key={`${s.kind}-${s.id}`} className="px-4 py-3 text-sm">
            <Link to={editor(s)} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:text-brand">{s.title}</Link>
            <span className="text-slate-500"> · {s.live ? "the live version stays" : "left out"}</span>
            <p className="mt-0.5 text-slate-600">{s.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Publish to the website: Super Admins only; everyone else sees the history. */
function PublishLive() {
  const { user } = useAuth();
  const [state, setState] = useState<LiveState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const load = () => api<LiveState>("/publish/live").then(setState).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  async function publish() {
    if (!window.confirm("Publish the current drafts to the website? Every finished draft goes live.")) return;
    setPublishing(true);
    setError("");
    setOutcome(null);
    try {
      setOutcome(await api<Outcome>("/publish/live", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
      load();
    }
  }

  const superAdmin = user?.role === "super_admin";
  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Publish to website</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {state?.configured
              ? <>Sends what changed to <b>{state.repo}</b> ({state.branch}). The website updates from there.</>
              : state ? <>Not set up on this server. Missing: {state.missing.join(", ")}.</> : "Loading…"}
          </p>
        </div>
        {superAdmin
          ? <button type="button" onClick={publish} disabled={publishing || !state?.configured} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-[#a8370a] disabled:cursor-not-allowed disabled:opacity-60">
              {publishing ? "Publishing…" : "Publish to website"}
            </button>
          : <p className="text-sm text-slate-500">Only a Super Admin can publish.</p>}
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {outcome && (
        <div role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {outcome.commit
            ? <>Published {outcome.files.length} changed file{outcome.files.length === 1 ? "" : "s"}. <a href={outcome.commit.url} target="_blank" rel="noopener" className="font-semibold underline">See the commit</a></>
            : "Nothing had changed: the website already matches the drafts."}
          {outcome.files.length > 0 && <p className="mt-1 text-emerald-700">{outcome.files.join(", ")}</p>}
        </div>
      )}
      {outcome && <SkippedList skipped={outcome.result.skipped} title="Drafts not published" />}
      {outcome && outcome.result.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">{outcome.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      {state && state.publishes.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Recent publishes</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {state.publishes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>{when(p.startedAt)}{p.by ? ` · ${p.by}` : ""}</span>
                <span className="text-slate-600">
                  {p.status === "running" && "Publishing…"}
                  {p.status === "failed" && <span className="text-red-700">Failed: {p.error}</span>}
                  {p.status === "done" && (p.commitUrl
                    ? <a href={p.commitUrl} target="_blank" rel="noopener" className="underline">{p.files.length} file{p.files.length === 1 ? "" : "s"} · commit</a>
                    : "No changes")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PublishCentre() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Preview>("/publish/preview").then(setPreview).catch((e) => {
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      else setError(e.message);
    });
  }, []);

  async function build() {
    setBuilding(true);
    setError("");
    try {
      const last = await api<Build>("/publish/preview", { method: "POST" });
      setPreview((p) => (p ? { ...p, last } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  const last = preview?.last;
  const busy = building || preview?.running;
  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Admin" }, { label: "Publish centre" }]} />
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Publish centre</h1>
        <p className="mt-1 text-sm text-slate-500">Publish your finished drafts to the website. On your own computer you can also build a local preview first.</p>
      </div>
      <PublishLive />
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {unavailable && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">The local preview is only available when the CMS runs on your own computer.</p>}

      {preview && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Local preview</h2>
              <p role="status" className="mt-0.5 text-sm text-slate-500">
                {busy ? "Building the site…" : last ? `Last built ${new Date(last.builtAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Not built since the CMS started."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a href={preview.url} target="_blank" rel="noopener" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-slate-300">Open site</a>
              <button type="button" onClick={build} disabled={!!busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-[#a8370a] disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Building…" : "Build preview"}
              </button>
            </div>
          </div>

          {last && (
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["Pages", last.counts.pages], ["Guides", last.counts.guides], ["Process areas", last.counts.areas], ["Files written", last.counts.files]] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-xl font-bold">{n}</dd>
                </div>
              ))}
            </dl>
          )}

          {last && last.skipped.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Drafts not in this preview</h3>
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {last.skipped.map((s) => (
                  <li key={`${s.kind}-${s.id}`} className="px-4 py-3 text-sm">
                    <Link to={editor(s)} className="font-semibold underline decoration-slate-300 underline-offset-2 hover:text-brand">{s.title}</Link>
                    <span className="text-slate-500"> · {s.live ? "showing the live version" : "left out"}</span>
                    <p className="mt-0.5 text-slate-600">{s.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {last && last.warnings.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Worth checking</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {last.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
