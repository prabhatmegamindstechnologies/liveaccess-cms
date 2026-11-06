// Serves the current site's CSS, fonts and images to the admin preview during local development.
// In production the admin runs on the same domain as the site, so the preview loads them from "/".
// Open to anyone who can reach it: <link> and <img> can't send a Bearer token, and these are the public site's own files.
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Hono } from "hono";

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2"
};
// Only files in the site root or images/ (no subfolders like cms/, node_modules/).
const SAFE_PATH = /^(images\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function previewAssets(siteRoot: string) {
  const app = new Hono();
  const root = resolve(siteRoot);
  app.get("/*", async (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.replace(/^.*?\/preview-assets\//, ""));
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
    const type = TYPES[extname(rel).toLowerCase()];
    if (!type || !SAFE_PATH.test(rel) || rel.includes("..")) return c.json({ error: "Not found." }, 404);
    const file = resolve(root, rel);
    if (!file.startsWith(root + sep)) return c.json({ error: "Not found." }, 404);
    try {
      const data = await readFile(file);
      // Sandbox every response so a file opened directly (e.g. an SVG with script) can't run as the admin.
      return c.body(data, 200, {
        "content-type": type,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
      });
    } catch {
      return c.json({ error: "Not found." }, 404);
    }
  });
  return app;
}
