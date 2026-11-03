// /<ADMIN_PATH>/api/guides — troubleshooting guides: list, create (draft), open, auto-save, delete (never-published
// drafts only). Live site files are only written by the Publish centre; `articles.published` holds what is live.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { and, desc, eq, ne } from "drizzle-orm";
import { parseHTML } from "linkedom";
import { slugify, validateGuide, type Block, type Guide } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { articles, revisions, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";

const REVISION_GAP_MS = 10 * 60 * 1000;
const DISCLAIMER = "This guide gives general checks. Settings, limits and procedures differ between machines: always use the values in your service documentation and your site procedures.";
const STARTER: Block[] = [
  { type: "callout", variant: "safety", title: "Safety first.", text: "" },
  { type: "heading", level: 2, text: "Symptoms" }, { type: "list", style: "bullet", items: [""] },
  { type: "heading", level: 2, text: "Likely causes" }, { type: "list", style: "bullet", items: [""] },
  { type: "heading", level: 2, text: "What to check, in order" }, { type: "list", style: "number", items: [""] },
  { type: "heading", level: 2, text: "When to call a TPS engineer" }, { type: "paragraph", html: "" },
  { type: "callout", variant: "disclaimer", title: "", text: DISCLAIMER }
];

type Row = typeof articles.$inferSelect;
const doc = () => parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;

/** The guide fields in the same shape as `articles.published`. */
const snapshot = (r: Row): Guide => ({
  slug: r.slug, title: r.title, summary: r.summary, areaSlug: r.areaSlug ?? "", publishedDate: r.publishedDate ?? "",
  blocks: r.blocks as Block[], seo: { title: r.seoTitle, description: r.seoDescription, noindex: r.noindex }
});
/** Key-order independent JSON (jsonb doesn't keep key order). */
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);
const hasChanges = (r: Row) => !r.published || stable(snapshot(r)) !== stable(r.published);

async function areaList(db: Db) {
  const rows = await db.select({ slug: articles.slug, name: articles.title }).from(articles).where(eq(articles.type, "area")).orderBy(articles.id);
  return rows;
}

/** A guide page to render the preview into: the guide's own live file, or any guide file. */
async function template(root: string | undefined, slug: string | undefined) {
  if (!root) return "";
  const names = (await readdir(root).catch(() => [] as string[])).filter((n) => /^guide-[a-z0-9-]+\.html$/.test(n)).sort();
  const name = slug && names.includes(`guide-${slug}.html`) ? `guide-${slug}.html` : names[0];
  return name ? readFile(join(root, name), "utf8").catch(() => "") : "";
}

export function guideRoutes(db: Db, siteFilesRoot?: string, limit: SaveLimit = { max: 120, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));
  // Auto-save sends at most one save every 2 s per tab.
  app.use("*", saveLimit(limit));

  const load = async (id: number) => {
    const [r] = await db.select({ row: articles, by: users.name }).from(articles).leftJoin(users, eq(users.id, articles.updatedBy))
      .where(and(eq(articles.id, id), eq(articles.type, "guide")));
    return r;
  };
  const view = (r: Row, by: string | null) => ({
    id: r.id, ...snapshot(r), status: r.status, live: r.published != null, hasChanges: hasChanges(r),
    version: r.version, updatedAt: r.updatedAt, updatedBy: by
  });
  const idOf = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);

  app.get("/", async (c) => {
    const rows = await db.select({ row: articles, by: users.name }).from(articles).leftJoin(users, eq(users.id, articles.updatedBy))
      .where(eq(articles.type, "guide")).orderBy(desc(articles.updatedAt));
    return c.json({ guides: rows.map(({ row, by }) => { const { blocks: _b, ...v } = view(row, by); return v; }) });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
    const base = slugify(title);
    if (!title || title.length > 120 || !base) return c.json({ error: "Give the guide a title.", errors: { title: "Give the guide a title." } }, 422);
    const user = c.get("user");
    const taken = new Set((await db.select({ slug: articles.slug }).from(articles).where(eq(articles.type, "guide"))).map((r) => r.slug));
    let slug = base;
    // "-2", "-3"… within the 80-character limit and without a double hyphen.
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 80 - String(n).length - 1).replace(/-+$/, "")}-${n}`;
    const [row] = await db.insert(articles).values({
      type: "guide", slug, title, summary: "", areaSlug: null, publishedDate: new Date().toISOString().slice(0, 10),
      blocks: STARTER, status: "draft", authorId: user.id, updatedBy: user.id
    }).onConflictDoNothing().returning();
    if (!row) return c.json({ error: "Someone just created a guide with the same title. Try again." }, 409);
    await audit(db, { userId: user.id, action: "guide_created", entityType: "article", entityId: row!.id });
    return c.json({ guide: view(row!, user.name) }, 201);
  });

  app.get("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    const r = id ? await load(id) : undefined;
    if (!r) return c.json({ error: "Guide not found." }, 404);
    const areas = await areaList(db);
    const full = validateGuide(snapshot(r.row), new Set(areas.map((a) => a.slug)), doc());
    return c.json({
      guide: view(r.row, r.by), areas,
      template: await template(siteFilesRoot, (r.row.published as Guide | null)?.slug),
      problems: full.ok ? {} : full.errors
    });
  });

  app.put("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "Guide not found." }, 404);
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion)) return c.json({ error: "Invalid guide data." }, 400);
    const areas = new Set((await areaList(db)).map((a) => a.slug));
    const check = validateGuide(body, areas, doc(), { partial: true });
    if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);
    const g = check.guide;
    const user = c.get("user");

    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.select().from(articles).where(and(eq(articles.id, id), eq(articles.type, "guide"))).for("update");
        if (!row) return c.json({ error: "Guide not found." }, 404);
        if (row.version !== body.baseVersion) {
          const [by] = row.updatedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
          return c.json({ error: `This guide was changed by ${by?.name ?? "someone else"} at ${row.updatedAt.toISOString()}. Reload to see their changes.`, version: row.version }, 409);
        }
        if (row.published && g.slug !== row.slug) return c.json({ error: "Some fields need fixing.", errors: { slug: "This guide is live, so its address can't change (links to it would break)." } }, 422);
        if (g.slug !== row.slug) {
          const [clash] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.type, "guide"), eq(articles.slug, g.slug), ne(articles.id, id)));
          if (clash) return c.json({ error: "Some fields need fixing.", errors: { slug: "Another guide already uses this address." } }, 422);
        }

        const [saved] = await tx.update(articles).set({
          slug: g.slug, title: g.title, summary: g.summary, areaSlug: g.areaSlug || null, publishedDate: g.publishedDate, blocks: g.blocks,
          seoTitle: g.seo.title, seoDescription: g.seo.description, noindex: g.seo.noindex,
          version: row.version + 1, updatedBy: user.id, updatedAt: new Date()
        }).where(eq(articles.id, id)).returning();

        // One revision per editing session: only if the last one is old or by someone else.
        const [last] = await tx.select().from(revisions).where(and(eq(revisions.entityType, "article"), eq(revisions.entityId, id)))
          .orderBy(desc(revisions.createdAt), desc(revisions.id)).limit(1);
        if (!last || last.userId !== user.id || Date.now() - last.createdAt.getTime() > REVISION_GAP_MS) {
          await tx.insert(revisions).values({ entityType: "article", entityId: id, userId: user.id, note: "Edited", snapshot: snapshot(saved!) });
          await audit(tx as unknown as Db, { userId: user.id, action: "guide_edited", entityType: "article", entityId: id });
        }
        return c.json({ version: saved!.version, hasChanges: hasChanges(saved!), updatedAt: saved!.updatedAt });
      });
    } catch (e) {
      // Two saves can pass the slug check at the same moment; the unique index then refuses the second one.
      if ((e as { code?: string } | null)?.code === "23505") return c.json({ error: "Some fields need fixing.", errors: { slug: "Another guide already uses this address." } }, 422);
      throw e;
    }
  });

  app.delete("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "Guide not found." }, 404);
    const user = c.get("user");
    // Checked under a row lock, so a publish can't slip in between the check and the delete.
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(articles).where(and(eq(articles.id, id), eq(articles.type, "guide"))).for("update");
      if (!row) return c.json({ error: "Guide not found." }, 404);
      if (row.published || row.status !== "draft") return c.json({ error: "Only drafts that were never published can be deleted. Live guides are taken down in the Publish centre." }, 409);
      await tx.delete(revisions).where(and(eq(revisions.entityType, "article"), eq(revisions.entityId, id)));
      await tx.delete(articles).where(eq(articles.id, id));
      await audit(tx as unknown as Db, { userId: user.id, action: "guide_deleted", entityType: "article", entityId: id, detail: { slug: row.slug, title: row.title } });
      return c.json({ ok: true });
    });
  });

  return app;
}
