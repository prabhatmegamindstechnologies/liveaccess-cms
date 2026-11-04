// The CMS API. Everything lives under /<ADMIN_PATH>/api so one rewrite rule on liveaccess.ai covers it.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authRoutes, type AuthConfig } from "./auth/routes.ts";
import { pageRoutes, type SaveLimit } from "./pages/routes.ts";
import { menuRoutes } from "./menus/routes.ts";
import { seoRoutes } from "./seo/routes.ts";
import { settingsRoutes } from "./settings/routes.ts";
import { articleRoutes } from "./articles/routes.ts";
import { previewAssets } from "./preview-assets.ts";
import { publishRoutes, type PreviewConfig } from "./publish/routes.ts";
import { userRoutes } from "./users/routes.ts";
import { auditRoutes } from "./audit/routes.ts";

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const tooLarge = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Request too large." }, 413) });
const pageSize = bodyLimit({ maxSize: 1_500_000, onError: (c) => c.json({ error: "The page is too large to save." }, 413) });
const guideSize = bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "The guide is too large to save." }, 413) });

/** What may be logged: a failed query's wrapper puts the query's values (password hashes, emails) in its message. */
export function loggable(err: Error) {
  const cause = err.cause as { name?: string; code?: string; message?: string } | undefined;
  return cause ? { name: cause.name, code: cause.code, message: cause.message } : err;
}

/**
 * siteRoot mounts the dev-only preview-asset route; leave it out in production.
 * siteFilesRoot is where robots.txt and llms.txt are read from the first time the SEO screen opens.
 * preview mounts the dev-only local site build; leave it out in production.
 */
export type AppConfig = AuthConfig & { siteRoot?: string; siteFilesRoot?: string; pageSaveLimit?: SaveLimit; preview?: PreviewConfig };

export function createApp(cfg: AppConfig) {
  const app = new Hono();
  const base = `/${cfg.adminPath}/api`;

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", c.res.headers.get("cache-control") ?? "no-store");
  });

  // Page saves carry a whole page (up to ~1 MB) and guide/area saves a whole article; every other request stays small.
  app.use("*", (c, next) => {
    const put = c.req.method === "PUT";
    if (put && c.req.path.startsWith(`${base}/pages/`)) return pageSize(c, next);
    if (put && (c.req.path.startsWith(`${base}/guides/`) || c.req.path.startsWith(`${base}/areas/`))) return guideSize(c, next);
    return tooLarge(c, next);
  });

  // Refuse changes started by another site (backs up the SameSite cookie and the CSRF token).
  app.use("*", async (c, next) => {
    if (CHANGES.has(c.req.method)) {
      if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "Cross-site request refused." }, 403);
      const origin = c.req.header("origin");
      if (origin) {
        let originHost = "";
        try { originHost = new URL(origin).host; } catch { /* malformed origin */ }
        const forwarded = cfg.trustProxy ? c.req.header("x-forwarded-host") : undefined;
        const host = forwarded ?? c.req.header("host") ?? new URL(c.req.url).host;
        if (originHost !== host) return c.json({ error: "Cross-site request refused." }, 403);
      }
    }
    await next();
  });

  app.route(`${base}/auth`, authRoutes(cfg));
  app.route(`${base}/pages`, pageRoutes(cfg.db, cfg.pageSaveLimit));
  app.route(`${base}/menus`, menuRoutes(cfg.db));
  app.route(`${base}/seo`, seoRoutes(cfg.db, cfg.adminPath, cfg.siteFilesRoot));
  app.route(`${base}/settings`, settingsRoutes(cfg.db));
  app.route(`${base}/users`, userRoutes(cfg.db, cfg.trustProxy));
  app.route(`${base}/audit`, auditRoutes(cfg.db));
  app.route(`${base}/guides`, articleRoutes("guide", cfg.db, cfg.siteFilesRoot));
  app.route(`${base}/areas`, articleRoutes("area", cfg.db, cfg.siteFilesRoot, { max: 30, windowMs: 60_000 }));
  if (cfg.siteRoot) app.route(`${base}/preview-assets`, previewAssets(cfg.db, cfg.siteRoot));
  if (cfg.preview) app.route(`${base}/publish`, publishRoutes(cfg.db, cfg.preview));
  app.get(`${base}/health`, (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  app.onError((err, c) => {
    console.error(loggable(err));
    return c.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
