import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../lib/auth.tsx";
import tpsLogo from "../assets/tps-logo.png";

// Sections not built yet open a "coming soon" screen (see SOON in main.tsx).
const NAV: { group: string; items: { label: string; to: string }[] }[] = [
  { group: "", items: [{ label: "Dashboard", to: "/dashboard" }] },
  { group: "Content", items: [{ label: "Pages", to: "/pages" }, { label: "Troubleshooting guides", to: "/guides" }, { label: "Process areas", to: "/areas" }, { label: "FAQ", to: "/pages/faq" }] },
  { group: "Assets", items: [{ label: "Media library", to: "/media" }] },
  { group: "Website", items: [{ label: "Menus", to: "/menus" }, { label: "SEO & redirects", to: "/seo" }, { label: "Site settings", to: "/settings" }] },
  { group: "Messages", items: [{ label: "Contact inbox", to: "/inbox" }] },
  { group: "Admin", items: [{ label: "Publish centre", to: "/publish" }, { label: "Users & roles", to: "/users" }, { label: "Audit log", to: "/audit" }] }
];

// Not offered to Editors; the API refuses them too.
const SUPER_ADMIN_ONLY = new Set(["/users", "/audit"]);

// Outline icons (24×24 paths) shown next to each label, and alone when the sidebar is collapsed.
const ICONS: Record<string, string> = {
  "Dashboard": "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  "Pages": "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  "Troubleshooting guides": "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z",
  "Process areas": "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5",
  "FAQ": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01",
  "Media library": "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5v.01",
  "Menus": "M4 6h16M4 12h16M4 18h16",
  "SEO & redirects": "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  "Site settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  "Contact inbox": "M4 4h16v16H4zM4 13h4l2 3h4l2-3h4",
  "Publish centre": "M12 16V4M7 9l5-5 5 5M4 20h16",
  "Users & roles": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7",
  "Audit log": "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4"
};

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`size-[18px] shrink-0 ${className}`}>
      <path d={d} />
    </svg>
  );
}

const SIDEBAR_KEY = "la-admin-sidebar";
const readCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_KEY) === "collapsed"; } catch { return false; }
};

export function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((it) => user?.role === "super_admin" || !SUPER_ADMIN_ONLY.has(it.to)) }));
  const initials = (user?.name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem(SIDEBAR_KEY, c ? "expanded" : "collapsed"); } catch { /* storage blocked: keep it for this visit */ }
      return !c;
    });
  }
  // FAQ is a page too; highlight only FAQ (not Pages) while it is open.
  const isActive = (to: string) => (to === "/pages" ? pathname.startsWith("/pages") && pathname !== "/pages/faq" : pathname === to || pathname.startsWith(`${to}/`));
  const toggleButton = (
    <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="grid size-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900">
      <Icon d={collapsed ? "M4 4h16v16H4zM9 4v16M13 10l2 2-2 2" : "M4 4h16v16H4zM9 4v16M16 10l-2 2 2 2"} />
    </button>
  );

  return (
    <div className="flex min-h-screen">
      <aside data-collapsed={collapsed} className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white text-slate-700 transition-[width] duration-200 motion-reduce:transition-none lg:flex ${collapsed ? "w-[72px]" : "w-64"}`}>
        <div className={`flex items-center border-b border-slate-200 h-[61px] shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
          <img src={tpsLogo} alt="TPS" width={150} height={32} className={collapsed ? "h-auto w-14 max-w-full" : "h-8 w-auto"} />
          {!collapsed && toggleButton}
        </div>
        {collapsed && <div className="flex shrink-0 justify-center pt-3">{toggleButton}</div>}
        <nav aria-label="Admin" className={`flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto py-3 [scrollbar-width:thin] ${collapsed ? "px-2" : "px-3"}`}>
          {nav.map((g) => (
            <div key={g.group || "top"}>
              {g.group && !collapsed && <h2 className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{g.group}</h2>}
              {g.group && collapsed && <hr className="mx-2 mb-2 border-slate-200" />}
              <ul className="grid gap-0.5">
                {g.items.map((it) => (
                  <li key={it.label}>
                    <NavLink to={it.to} title={collapsed ? it.label : undefined} aria-label={collapsed ? it.label : undefined}
                      className={`flex items-center gap-3 rounded-lg py-[7px] text-sm whitespace-nowrap ${collapsed ? "justify-center px-0" : "px-3"} ${isActive(it.to) ? "bg-brand-soft font-semibold text-brand" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"}`}>
                      <Icon d={ICONS[it.label] ?? ""} />
                      {!collapsed && <span className="min-w-0 truncate">{it.label}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[61px] shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-white px-6">
          <span className="grid size-8 place-items-center rounded-full bg-slate-200 text-xs font-bold" aria-hidden="true">{initials}</span>
          <span className="text-sm leading-tight">
            {user?.name}
            <span className="block text-xs text-slate-500">{user?.role === "super_admin" ? "Super Admin" : "Editor"}</span>
          </span>
          <Link to="/change-password" className="text-sm font-semibold text-slate-600 hover:text-slate-900">Change password</Link>
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
