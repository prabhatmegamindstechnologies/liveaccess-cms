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
            <Route path="*" element={<Navigate to="/pages" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
);
