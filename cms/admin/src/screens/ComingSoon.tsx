// Placeholder for admin sections that are not built yet.
import { Link } from "react-router";
import { Breadcrumb } from "../components/ui.tsx";

export function ComingSoon({ title, about }: { title: string; about: string }) {
  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: title }]} />
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-sm text-slate-500">{about}</p>
      <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <p className="text-base font-semibold">This section is coming soon.</p>
        <p className="mt-1 text-sm text-slate-500">It's being built. Pages and FAQ can be edited now.</p>
        <Link to="/pages" className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-[#a8370a]">Go to Pages</Link>
      </div>
    </div>
  );
}
