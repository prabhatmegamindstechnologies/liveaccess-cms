// The CMS API. Everything lives under /<ADMIN_PATH>/api so one rewrite rule on liveaccess.ai covers it.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authRoutes, type AuthConfig } from "./auth/routes.ts";

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createApp(cfg: AuthConfig) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "no-store");
  });

  // Media uploads (Day 3) will raise this on their own route.
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Request too large." }, 413) }));

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

  app.route(`/${cfg.adminPath}/api/auth`, authRoutes(cfg));
  app.get(`/${cfg.adminPath}/api/health`, (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong." }, 500);
  });
  return app;
}
