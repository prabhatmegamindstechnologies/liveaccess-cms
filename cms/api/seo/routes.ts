// /<ADMIN_PATH>/api/seo — redirects, robots.txt, llms.txt and SEO defaults (drafts), plus the generated sitemap.
// Saving never touches page HTML or site files: the Publish centre writes them later.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { buildSitemap, checkLlms, checkRobots, validateDefaults, validateRedirects, type Redirect, type SeoDefaults } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { articles, pages, redirects, settings } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireSuperAdmin, requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";
import { editorNames, FRESH, saveVersioned, type Meta, type Stored } from "../versioned-setting.ts";

type Part = "redirects" | "robots" | "llms" | "defaults";
const KEY: Record<Part, string> = { redirects: "seo.redirects", robots: "seo.robots", llms: "seo.llms", defaults: "seo.defaults" };

/** Links a redirect can point to (same list as the menus' link picker). */
async function linkOptions(db: Db) {
  const ps = await db.select({ title: pages.title, url: pages.url }).from(pages).orderBy(pages.id);
  const as = await db.select({ type: articles.type, slug: articles.slug, title: articles.title }).from(articles).orderBy(articles.type, articles.id);
  return [
    ...ps.map((p) => ({ group: "Pages", label: p.title, href: p.url === "/" ? "./" : p.url.replace(/^\//, "") })),
    ...as.map((a) => ({ group: a.type === "guide" ? "Troubleshooting guides" : "Process areas", label: a.title, href: `${a.type}-${a.slug}.html` }))
  ];
}

/** sitemap.xml from published, indexable pages and articles. */
async function sitemap(db: Db) {
  const ps = await db.select({ url: pages.url, noindex: pages.noindex, publishedAt: pages.publishedAt, updatedAt: pages.updatedAt }).from(pages).orderBy(pages.id);
  const as = await db.select({ type: articles.type, slug: articles.slug, publishedSlug: articles.publishedSlug, status: articles.status, noindex: articles.noindex, publishedDate: articles.publishedDate, updatedAt: articles.updatedAt })
    .from(articles).orderBy(articles.type, articles.id);
  const entries = [
    ...ps.filter((p) => !p.noindex).map((p) => ({ path: p.url.replace(/^\//, ""), lastmod: p.publishedAt ?? p.updatedAt })),
    ...as.filter((a) => a.status === "published" && !a.noindex).map((a) => ({ path: `${a.type}-${a.publishedSlug ?? a.slug}.html`, lastmod: a.publishedDate ?? a.updatedAt }))
  ];
  return { xml: buildSitemap(entries), count: entries.length };
}

const meta = (html: string, attr: "name" | "property", key: string) =>
  new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html)?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, `"`) ?? "";

/** First-open values: today's site files and the home page's meta tags. */
async function seed(db: Db, root: string | undefined, part: Part): Promise<unknown> {
  if (part === "redirects") return [];
  if (part === "robots" || part === "llms") {
    if (!root) return "";
    const text = await readFile(join(root, part === "robots" ? "robots.txt" : "llms.txt"), "utf8").catch(() => "");
    return text.replace(/\r\n/g, "\n");
  }
  const [home] = await db.select({ html: pages.html, live: pages.publishedHtml }).from(pages).where(eq(pages.key, "home"));
  const html = home?.live ?? home?.html ?? "";
  const image = meta(html, "property", "og:image");
  const card = meta(html, "name", "twitter:card");
  return {
    description: meta(html, "property", "og:description") || meta(html, "name", "description"),
    shareImage: image.replace(/^https:\/\/liveaccess\.ai\//, "") || "logo.png",
    cardType: card === "summary_large_image" ? card : "summary"
  } satisfies SeoDefaults;
}

/** Real .html files in the site folder ("/404.html", …): they can't be redirected. */
async function siteHtmlFiles(root: string | undefined) {
  if (!root) return new Set<string>();
  const names = await readdir(root).catch(() => [] as string[]);
  return new Set(names.filter((n) => n.endsWith(".html")).map((n) => `/${n}`));
}

export function seoRoutes(db: Db, adminPath: string, siteFilesRoot?: string, limit: SaveLimit = { max: 30, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));
  app.use("*", saveLimit(limit));

  app.get("/", async (c) => {
    const rows = await db.select().from(settings).where(inArray(settings.key, Object.values(KEY)));
    const stored = (part: Part) => rows.find((r) => r.key === KEY[part])?.value as Stored<unknown> | Meta | undefined;
    const names = await editorNames(db, rows.map((r) => r.value as Meta));

    const out: Record<string, unknown> = {};
    for (const part of Object.keys(KEY) as Part[]) {
      const s = stored(part) ?? FRESH;
      const value = part === "redirects"
        ? (await db.select().from(redirects).orderBy(redirects.id)).map((r) => ({ from: r.fromPath, to: r.toPath, code: r.code }))
        : "value" in s ? s.value : await seed(db, siteFilesRoot, part);
      out[part] = { value, version: s.version, updatedAt: s.updatedAt, updatedBy: s.updatedBy ? names.get(s.updatedBy) ?? null : null };
    }
    return c.json({ ...out, sitemap: await sitemap(db), links: await linkOptions(db), canEdit: c.get("user").role === "super_admin" });
  });

  app.put("/:part", requireSuperAdmin, async (c) => {
    const part = c.req.param("part") as Part;
    // Own keys only: `in` would also accept inherited names like "constructor" or "__proto__".
    if (!Object.hasOwn(KEY, part)) return c.json({ error: "Not found." }, 404);
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion) || body?.value === undefined) return c.json({ error: "Invalid data." }, 400);

    let value: unknown;
    if (part === "redirects") {
      const known = new Set((await linkOptions(db)).map((o) => o.href));
      const check = validateRedirects(body.value, known, adminPath, await siteHtmlFiles(siteFilesRoot));
      if (!check.ok) return c.json({ error: "Some redirects need fixing.", errors: check.errors }, 422);
      value = check.redirects;
    } else if (part === "defaults") {
      const check = validateDefaults(body.value);
      if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);
      value = check.defaults;
    } else {
      const text = typeof body.value === "string" ? body.value.replace(/\r\n/g, "\n") : null;
      const problem = text === null ? "Invalid text." : part === "robots" ? checkRobots(text) : checkLlms(text);
      if (problem) return c.json({ error: problem, errors: { value: problem } }, 422);
      value = text;
    }

    const user = c.get("user");
    return db.transaction(async (tx) => {
      const r = await saveVersioned(tx, KEY[part], body.baseVersion, user.id, part === "redirects" ? undefined : value);
      if (!r.ok) return c.json({ error: r.error, version: r.version }, 409);

      if (part === "redirects") {
        await tx.delete(redirects);
        const list = value as Redirect[];
        if (list.length) await tx.insert(redirects).values(list.map((r) => ({ fromPath: r.from, toPath: r.to, code: r.code })));
      }
      await audit(tx as unknown as Db, { userId: user.id, action: `seo_${part}_edited`, entityType: "seo", entityId: part });
      return c.json({ version: r.meta.version, updatedAt: r.meta.updatedAt, value });
    });
  });

  return app;
}
