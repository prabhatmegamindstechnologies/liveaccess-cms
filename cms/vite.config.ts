// Admin panel (React) build and dev server. Served at /<ADMIN_PATH>/; the API is proxied in development.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { env } from "./env.ts";

export default defineConfig({
  root: "admin",
  base: `/${env.adminPath}/`,
  plugins: [react(), tailwindcss()],
  define: { __ADMIN_PATH__: JSON.stringify(env.adminPath) },
  server: {
    port: 5173,
    strictPort: true,
    // Keep the browser's Host header so the API's same-origin check sees localhost:5173 on both sides.
    proxy: { [`/${env.adminPath}/api`]: { target: `http://localhost:${env.port}`, changeOrigin: false } }
  },
  build: { outDir: "../dist/admin", emptyOutDir: true }
});
