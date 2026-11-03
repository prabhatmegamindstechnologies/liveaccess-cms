import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ADMIN_PATH } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

// Sections that arrive on later days are listed (so editors see what's coming) but disabled.
const NAV: { group: string; items: { label: string; to?: string; day?: number }[] }[] = [
  { group: "", items: [{ label: "Dashboard", day: 5 }] },
  { group: "Content", items: [{ label: "Pages", to: "/pages" }, { label: "Troubleshooting guides", day: 3 }, { label: "Process areas", day: 3 }, { label: "FAQ", to: "/pages/faq" }] },
  { group: "Assets", items: [{ label: "Media library", day: 3 }] },
  { group: "Website", items: [{ label: "Menus", day: 5 }, { label: "SEO & redirects", day: 5 }, { label: "Site settings", day: 5 }] },
  { group: "Messages", items: [{ label: "Contact inbox", day: 5 }] },
  { group: "Admin", items: [{ label: "Publish centre", day: 4 }, { label: "Users & roles", day: 5 }, { label: "Audit log", day: 5 }] }
];

const SIDEBAR_KEY = "la-admin-sidebar";
const readCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_KEY) === "collapsed"; } catch { return false; }
};
// Short label for the collapsed rail, e.g. "Troubleshooting guides" → "TG".
const short = (label: string) => label.split(/[\s&]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const initials = (user?.name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem(SIDEBAR_KEY, c ? "expanded" : "collapsed"); } catch { /* storage blocked: keep it for this visit */ }
      return !c;
    });
  }
  // FAQ is a page too; highlight only FAQ (not Pages) while it is open.
  const isActive = (to: string) => (to === "/pages" ? pathname.startsWith("/pages") && pathname !== "/pages/faq" : pathname === to);

  return (
    <div className="flex min-h-screen">
      <aside data-collapsed={collapsed} className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-navy text-slate-300 transition-[width] duration-200 motion-reduce:transition-none lg:flex ${collapsed ? "w-16" : "w-60"}`}>
        <div className={`flex items-center gap-3 py-4 text-white ${collapsed ? "flex-col px-2" : "px-4"}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-bright text-sm font-extrabold">LA</span>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight font-bold">
              LiveAccess Admin
              <span className="block truncate text-xs font-medium text-slate-400">liveaccess.ai/{ADMIN_PATH}</span>
            </span>
          )}
          <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-slate-600 text-sm text-slate-300 hover:border-slate-400 hover:text-white">
            {collapsed ? "»" : "«"}
          </button>
        </div>
        <nav aria-label="Admin" className={`flex flex-1 flex-col gap-4 overflow-y-auto pb-6 ${collapsed ? "px-2" : "px-3"}`}>
          {NAV.map((g) => (
            <div key={g.group || "top"}>
              {g.group && !collapsed && <h2 className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{g.group}</h2>}
              {g.group && collapsed && <hr className="mx-2 mb-2 border-slate-700" />}
              <ul className="grid gap-0.5">
                {g.items.map((it) => (
                  <li key={it.label}>
                    {it.to ? (
                      <NavLink to={it.to} title={collapsed ? it.label : undefined} aria-label={collapsed ? it.label : undefined}
                        className={`flex rounded-md py-1.5 text-sm ${collapsed ? "justify-center px-0 font-bold" : "px-2.5"} ${isActive(it.to) ? "bg-brand font-semibold text-white" : "text-slate-200 hover:bg-navy-2 hover:text-white"}`}>
                        {collapsed ? short(it.label) : it.label}
                      </NavLink>
                    ) : (
                      <span title={`${it.label} — coming on Day ${it.day}`} aria-label={collapsed ? `${it.label}, coming on Day ${it.day}` : undefined}
                        className={`flex rounded-md py-1.5 text-sm text-slate-500 ${collapsed ? "justify-center px-0 font-bold" : "justify-between px-2.5"}`}>
                        {collapsed ? short(it.label) : <>{it.label}<span className="text-[10px] font-semibold text-slate-600">Day {it.day}</span></>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-bold" aria-hidden="true">{initials}</span>
          <span className="text-sm leading-tight">
            {user?.name}
            <span className="block text-xs text-slate-500">{user?.role === "super_admin" ? "Super Admin" : "Editor"}</span>
          </span>
          <button type="button" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold hover:border-slate-300"
            onClick={async () => { await logout(); navigate("/login"); }}>
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
