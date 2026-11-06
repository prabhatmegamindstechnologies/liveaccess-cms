// /<ADMIN_PATH>/api/publish/preview — builds the local preview of the site from the drafts. Mounted in development only.
// Nothing here publishes: drafts stay drafts and the live site isn't touched.
import { Hono } from "hono";
import type { Db } from "../../db/client.ts";
import { buildSite, type BuildResult } from "../../publish/build-site.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";

export type PreviewConfig = { siteRoot: string; previewRoot: string; url: string };

export function publishRoutes(db: Db, cfg: PreviewConfig, limit: SaveLimit = { max: 10, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  let running = false;
  let last: BuildResult | null = null;

  app.use("*", requireUser());
  app.use("*", saveLimit(limit));

  app.get("/preview", (c) => c.json({ running, last, url: cfg.url }));

  app.post("/preview", async (c) => {
    if (running) return c.json({ error: "A preview is already being built." }, 409);
    running = true;
    try {
      last = await buildSite(db, cfg);
      await audit(db, { userId: c.get("user").id, action: "preview_built", entityType: "publish", detail: last.counts });
      return c.json(last);
    } catch (e) {
      console.error(e);
      return c.json({ error: "The preview couldn't be built. The last preview is still in place." }, 500);
    } finally {
      running = false;
    }
  });

  return app;
}
