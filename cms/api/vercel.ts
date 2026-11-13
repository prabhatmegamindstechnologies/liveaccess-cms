// The API as a Vercel Function (`api/cms.ts` at the repo root). vercel.json rewrites /<ADMIN_PATH>/api/:path* to /api/cms,
// Vercel adds the matched part as ?path=..., and this turns the request back into the URL createApp() expects.
// Not available here yet: image uploads (no lasting disk; a Blob driver comes later) and the local site preview.
import { Hono } from "hono";
import { env } from "../env.ts";
import { createDb } from "../db/client.ts";
import { createApp, type AppConfig } from "./app.ts";
import { disabledDriver } from "./media/storage.ts";

export const PATH_PARAM = "path";
export const UPLOADS_OFF = "Image uploads aren't available on this server yet.";

const BODYLESS = new Set(["GET", "HEAD"]);

/** The request as createApp() expects it, or null if it doesn't point inside /<adminPath>/api. */
export function restoreRequest(req: Request, adminPath: string): Request | null {
  const base = `/${adminPath}/api`;
  const inside = (p: string) => p === base || p.startsWith(`${base}/`);
  const url = new URL(req.url);
  const rest = url.searchParams.get(PATH_PARAM);
  url.searchParams.delete(PATH_PARAM);

  let path = url.pathname;
  if (!inside(path)) {
    if (rest === null) return null;
    // Encoded slashes and dots would let "..%2F" past the check below, and no API route needs them.
    if (/%2f|%5c|%2e|\\/i.test(rest) || rest.split("/").some((s) => s === "." || s === "..")) return null;
    path = `${base}/${rest.replace(/^\/+/, "")}`;
  }
  const target = new URL(path, url.origin);
  if (!inside(target.pathname)) return null;
  target.search = url.search;

  return new Request(target, {
    method: req.method,
    headers: req.headers,
    body: BODYLESS.has(req.method) ? undefined : req.body,
    signal: req.signal,
    // Required by Node's fetch to pass a streamed body on.
    duplex: "half"
  } as RequestInit);
}

/** createApp() for Vercel: uploads answer 503 and nothing is written to the Function's temporary disk. */
export function vercelApp(cfg: Omit<AppConfig, "mediaStorage" | "siteRoot" | "preview">) {
  const base = `/${cfg.adminPath}/api`;
  const inner = createApp({ ...cfg, mediaStorage: disabledDriver() });
  const outer = new Hono();
  const off = () => Response.json({ error: UPLOADS_OFF }, { status: 503 });
  outer.post(`${base}/media`, off);
  outer.post(`${base}/media/:id/replace`, off);
  outer.all("*", (c) => inner.fetch(c.req.raw));

  return (req: Request) => {
    const restored = restoreRequest(req, cfg.adminPath);
    return restored ? outer.fetch(restored) : Response.json({ error: "Not found." }, { status: 404 });
  };
}

let handler: ((req: Request) => Response | Promise<Response>) | undefined;

/** Built on the first request, so a missing setting shows in the Function log rather than failing the deployment. */
export function vercelHandler(req: Request) {
  handler ??= (() => {
    env.jwtSecret(); // Refuse to run without it, like the local server.
    const { db } = createDb(env.databaseUrl(), { max: 2 });
    // trustProxy: Vercel sets x-real-ip and x-forwarded-host itself. siteFilesRoot: the repo files listed in vercel.json includeFiles.
    return vercelApp({ db, adminPath: env.adminPath, secureCookies: true, trustProxy: true, siteFilesRoot: env.siteRoot });
  })();
  return handler(req);
}
