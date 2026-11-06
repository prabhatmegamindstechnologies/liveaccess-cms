import { StrictMode, type ReactNode } from "react";
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
import { Dashboard } from "./screens/Dashboard.tsx";
import { MenusEditor } from "./screens/MenusEditor.tsx";
import { SeoEditor } from "./screens/SeoEditor.tsx";
import { SettingsEditor } from "./screens/SettingsEditor.tsx";
import { ArticlesList } from "./screens/ArticlesList.tsx";
import { AreaEditor } from "./screens/AreaEditor.tsx";
import { GuideEditor } from "./screens/GuideEditor.tsx";
import { PublishCentre } from "./screens/PublishCentre.tsx";
import { UsersList } from "./screens/UsersList.tsx";
import { AuditLog } from "./screens/AuditLog.tsx";
import { ChangePassword } from "./screens/ChangePassword.tsx";
import { MediaLibrary } from "./screens/MediaLibrary.tsx";

// Sidebar sections that are not built yet.
const SOON: { path: string; title: string; about: string }[] = [
  { path: "/inbox", title: "Contact inbox", about: "Messages sent from the website contact form." }
];

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return user.mustChangePassword ? <ChangePassword forced /> : <Shell />;
}

/** The API refuses these sections anyway; this says so instead of showing an error. */
function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "super_admin") return children;
  return <p role="note" className="mx-auto max-w-6xl rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">This section is for Super Admins only.</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter basename={`/${ADMIN_PATH}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/pages" element={<PagesList />} />
            <Route path="/pages/:key" element={<PageEditor />} />
            <Route path="/menus" element={<MenusEditor />} />
            <Route path="/seo" element={<SeoEditor />} />
            <Route path="/settings" element={<SettingsEditor />} />
            <Route path="/guides" element={<ArticlesList key="guide" kind="guide" />} />
            <Route path="/guides/:id" element={<GuideEditor />} />
            <Route path="/areas" element={<ArticlesList key="area" kind="area" />} />
            <Route path="/areas/:id" element={<AreaEditor />} />
            <Route path="/media" element={<MediaLibrary />} />
            <Route path="/publish" element={<PublishCentre />} />
            <Route path="/users" element={<SuperAdminOnly><UsersList /></SuperAdminOnly>} />
            <Route path="/audit" element={<SuperAdminOnly><AuditLog /></SuperAdminOnly>} />
            <Route path="/change-password" element={<ChangePassword />} />
            {SOON.map((s) => <Route key={s.path} path={s.path} element={<ComingSoon title={s.title} about={s.about} />} />)}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
