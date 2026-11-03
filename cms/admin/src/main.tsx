import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { ADMIN_PATH } from "./lib/api.ts";
import { AuthProvider, useAuth } from "./lib/auth.tsx";
import { Shell } from "./components/Shell.tsx";
import { Login } from "./screens/Login.tsx";
import { PagesList } from "./screens/PagesList.tsx";
import { PageEditor } from "./screens/PageEditor.tsx";
import { ComingSoon } from "./screens/ComingSoon.tsx";
import { MenusEditor } from "./screens/MenusEditor.tsx";
import { SeoEditor } from "./screens/SeoEditor.tsx";
import { SettingsEditor } from "./screens/SettingsEditor.tsx";
import { ArticlesList } from "./screens/ArticlesList.tsx";
import { AreaEditor } from "./screens/AreaEditor.tsx";
import { GuideEditor } from "./screens/GuideEditor.tsx";

// Sidebar sections that are not built yet.
const SOON: { path: string; title: string; about: string }[] = [
  { path: "/dashboard", title: "Dashboard", about: "Recent edits, drafts waiting to be published and new messages." },
  { path: "/media", title: "Media library", about: "Upload images, add alt text and reuse them across the site." },
  { path: "/inbox", title: "Contact inbox", about: "Messages sent from the website contact form." },
  { path: "/publish", title: "Publish centre", about: "Review draft changes and publish them to the live site." },
  { path: "/users", title: "Users & roles", about: "Add Super Admins and Editors, reset passwords." },
  { path: "/audit", title: "Audit log", about: "Who changed what, and when." }
];

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-slate-500">Loading…</p>;
  return user ? <Shell /> : <Navigate to="/login" replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter basename={`/${ADMIN_PATH}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Navigate to="/pages" replace />} />
            <Route path="/pages" element={<PagesList />} />
            <Route path="/pages/:key" element={<PageEditor />} />
            <Route path="/menus" element={<MenusEditor />} />
            <Route path="/seo" element={<SeoEditor />} />
            <Route path="/settings" element={<SettingsEditor />} />
            <Route path="/guides" element={<ArticlesList key="guide" kind="guide" />} />
            <Route path="/guides/:id" element={<GuideEditor />} />
            <Route path="/areas" element={<ArticlesList key="area" kind="area" />} />
            <Route path="/areas/:id" element={<AreaEditor />} />
            {SOON.map((s) => <Route key={s.path} path={s.path} element={<ComingSoon title={s.title} about={s.about} />} />)}
            <Route path="*" element={<Navigate to="/pages" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
