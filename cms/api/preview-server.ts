// Serves .site-preview/ on localhost during development, behaving like the site's .htaccess. The built files are what
// real Publish will write, so what makes them safe to open locally is in these headers: Google Analytics and Tag Manager
// are blocked, and nothing gets indexed. The one thing that can be sent is the contact form, which goes to the local
// CMS API (`contact`), as it will on the shared domain; every other POST is refused.
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Hono } from "hono";
import { readHtaccessRedirects, SITE_ORIGIN } from "@liveaccess/shared";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".woff2": "font/woff2"
};
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "media-src 'self'", "connect-src 'self'", "form-action 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'self'"
].join("; ");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
// Files in the output folder or images/, no hidden files: the same rule as the admin preview's assets.
const SAFE_PATH = /^(images\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NOT_BUILT = `<!doctype html><title>No preview yet</title><p>No preview yet. Click <b>Build preview</b> in the Publish centre, or run <code>pnpm build:site</code>.</p>`;

/** `env` is the preview's own server context, passed on so the API sees the visitor's real connection (for its limits). */
export type PreviewContact = { adminPath: string; send: (req: Request, env: unknown) => Response | Promise<Response> };

export function previewSite(dir: string, contact?: PreviewContact) {
  const app = new Hono();
  const root = resolve(dir);
  const contactPath = contact ? `/${contact.adminPath}/api/contact` : null;

  /** The contents of a file in the output folder, or null. */
  const load = async (rel: string) => {
    if (!SAFE_PATH.test(rel) || rel.includes("..") || !TYPES[extname(rel).toLowerCase()]) return null;
    const file = resolve(root, rel);
    if (!file.startsWith(root + sep)) return null;
    return readFile(file).catch(() => null);
  };

  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP);
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("X-Content-Type-Options", "nosniff");
    // Also keeps a 301 from sticking in the browser after the redirect is changed and the preview rebuilt.
    c.header("Cache-Control", "no-store");
  });

  app.all("*", async (c) => {
    // Only this machine: a web page can't reach the drafts by pointing its own domain name at 127.0.0.1.
    const host = (c.req.header("host") ?? new URL(c.req.url).host).replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) return c.text("Forbidden.", 403);
    if (c.req.method === "POST" && contact && new URL(c.req.url).pathname === contactPath) return contact.send(c.req.raw, c.env);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("This is a read-only preview: nothing is sent from here.", 405);

    const notFound = async () => {
      const page = await load("404.html");
      return page ? c.body(new Uint8Array(page), 404, { "content-type": TYPES[".html"]! }) : c.html(NOT_BUILT, 404);
    };

    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return notFound();
    }
    if (path === "/index.html") return c.redirect("/", 301);
    const rel = path === "/" ? "index.html" : path.slice(1);

    const body = await load(rel);
    if (body) return c.body(new Uint8Array(body), 200, { "content-type": TYPES[extname(rel).toLowerCase()]! });

    const rules = readHtaccessRedirects(await readFile(join(root, ".htaccess"), "utf8").catch(() => ""));
    const rule = rules.find((r) => r.from === path);
    // Links into the site stay on the preview.
    if (rule) return c.redirect(rule.to.startsWith(`${SITE_ORIGIN}/`) ? rule.to.slice(SITE_ORIGIN.length) : rule.to, rule.code);

    const page = rel.replace(/\/$/, "");
    if (!page.endsWith(".html") && await load(`${page}.html`)) return c.redirect(`/${page}.html`, 301);
    return notFound();
  });

  return app;
}
