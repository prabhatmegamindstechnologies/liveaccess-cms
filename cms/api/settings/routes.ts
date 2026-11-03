// /<ADMIN_PATH>/api/settings — site-wide values (name, tagline, store links, emails, analytics IDs) as a draft.
// Anyone signed in can read them; only a Super Admin can save. Page HTML is never touched here.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { validateSiteSettings, type SiteSettings } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { pages, settings } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";
import { editorNames, FRESH, saveVersioned, type Stored } from "../versioned-setting.ts";

const KEY = "site.settings";
// &amp; last, so "&amp;lt;" stays "&lt;" (text) instead of becoming "<".
const decode = (s: string) => s.replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** First-open values, read from the live home page. */
async function seed(db: Db): Promise<SiteSettings> {
  const [home] = await db.select({ html: pages.html, live: pages.publishedHtml }).from(pages).where(eq(pages.key, "home"));
  const html = home?.live ?? home?.html ?? "";
  const find = (re: RegExp) => decode(re.exec(html)?.[1] ?? "");
  // The home page has no mailto link; take the first one on any page.
  const all = await db.select({ html: pages.html, live: pages.publishedHtml }).from(pages).orderBy(pages.id);
  const mail = all.map((p) => /href="mailto:([^"?]+)/.exec(p.live ?? p.html)?.[1]).find(Boolean) ?? "";
  return {
    siteName: find(/<meta property="og:site_name" content="([^"]*)"/) || "LiveAccess",
    tagline: find(/<footer class="site-footer">[\s\S]*?<\/b><br \/>\s*([^<]+?)\s*<br \/>/),
    appStore: find(/href="(https:\/\/apps\.apple\.com\/[^"]*)"/),
    // The base Play link, without the per-page referrer (Publish keeps each page's own referrer).
    playStore: find(/href="(https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+)/),
    email: decode(mail),
    notifyEmail: "",
    ga4: find(/googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/),
    gtm: find(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/)
  };
}

export function settingsRoutes(db: Db, limit: SaveLimit = { max: 30, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));
  app.use("*", saveLimit(limit));

  app.get("/", async (c) => {
    const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
    const s = (row?.value as Stored<SiteSettings> | undefined) ?? { ...FRESH, value: await seed(db) };
    const names = await editorNames(db, [s]);
    return c.json({
      value: s.value, version: s.version, updatedAt: s.updatedAt,
      updatedBy: s.updatedBy ? names.get(s.updatedBy) ?? null : null,
      canEdit: c.get("user").role === "super_admin"
    });
  });

  app.put("/", async (c) => {
    const user = c.get("user");
    if (user.role !== "super_admin") return c.json({ error: "Only a Super Admin can change site settings." }, 403);
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion) || body?.value === undefined) return c.json({ error: "Invalid data." }, 400);
    const check = validateSiteSettings(body.value);
    if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);

    return db.transaction(async (tx) => {
      const r = await saveVersioned(tx, KEY, body.baseVersion, user.id, check.settings, "Site settings");
      if (!r.ok) return c.json({ error: r.error, version: r.version }, 409);
      await audit(tx as unknown as Db, { userId: user.id, action: "site_settings_edited", entityType: "settings", entityId: KEY });
      return c.json({ version: r.meta.version, updatedAt: r.meta.updatedAt, value: check.settings });
    });
  });

  return app;
}
