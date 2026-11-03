// /<ADMIN_PATH>/api/guides and /api/areas — troubleshooting guides and process areas share one set of routes: list,
// create (draft), open, save (with version check), delete (never-published drafts only). Live site files are only
// written by the Publish centre; `articles.published` holds what is live.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { parseHTML } from "linkedom";
import { slugify, validateArea, validateGuide, type Block, type Guide } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { articles, revisions, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";

const REVISION_GAP_MS = 10 * 60 * 1000;
type Row = typeof articles.$inferSelect;
type Kind = "guide" | "area";
const doc = () => parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;

const STARTER: Record<Kind, Block[]> = {
  guide: [
    { type: "callout", variant: "safety", title: "Safety first.", text: "" },
    { type: "heading", level: 2, text: "Symptoms" }, { type: "list", style: "bullet", items: [""] },
    { type: "heading", level: 2, text: "Likely causes" }, { type: "list", style: "bullet", items: [""] },
    { type: "heading", level: 2, text: "What to check, in order" }, { type: "list", style: "number", items: [""] },
    { type: "heading", level: 2, text: "When to call a TPS engineer" }, { type: "paragraph", html: "" },
    { type: "callout", variant: "disclaimer", title: "", text: "This guide gives general checks. Settings, limits and procedures differ between machines: always use the values in your service documentation and your site procedures." }
  ],
  area: [
    { type: "heading", level: 2, text: "Common topics" }, { type: "list", style: "bullet", items: [""] },
    { type: "heading", level: 2, text: "Questions you can ask in LiveAccess" }, { type: "list", style: "bullet", items: [""] },
    { type: "heading", level: 2, text: "Talk to an expert" }, { type: "paragraph", html: "" },
    { type: "callout", variant: "disclaimer", title: "", text: "Answers in LiveAccess may be inaccurate or out of date. Always confirm safety-critical steps against your site procedures or with a TPS engineer." }
  ]
};

/** The article fields in the same shape as `articles.published` (areas have an empty area and date). */
const snapshot = (r: Row): Guide => ({
  slug: r.slug, title: r.title, summary: r.summary, areaSlug: r.areaSlug ?? "", publishedDate: r.publishedDate ?? "",
  blocks: r.blocks as Block[], seo: { title: r.seoTitle, description: r.seoDescription, noindex: r.noindex }
});
/** Key-order independent JSON (jsonb doesn't keep key order). */
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);
const hasChanges = (r: Row) => !r.published || stable(snapshot(r)) !== stable(r.published);

const areaList = (db: Db) => db.select({ slug: articles.slug, name: articles.title }).from(articles).where(eq(articles.type, "area")).orderBy(articles.id);
/** The guides that belong to an area, in database order (as they appear on the area page). */
const guidesOf = (db: Db, slug: string) => db.select({ id: articles.id, slug: articles.slug, title: articles.title, summary: articles.summary, status: articles.status, published: articles.published })
  .from(articles).where(and(eq(articles.type, "guide"), eq(articles.areaSlug, slug))).orderBy(asc(articles.id));

/** A page to render the preview into: the article's own live file, or any file of that kind. */
async function template(root: string | undefined, kind: Kind, slug: string | undefined) {
  if (!root) return "";
  const re = new RegExp(`^${kind}-[a-z0-9-]+\\.html$`);
  const names = (await readdir(root).catch(() => [] as string[])).filter((n) => re.test(n)).sort();
  const name = slug && names.includes(`${kind}-${slug}.html`) ? `${kind}-${slug}.html` : names[0];
  return name ? readFile(join(root, name), "utf8").catch(() => "") : "";
}

export function articleRoutes(kind: Kind, db: Db, siteFilesRoot?: string, limit: SaveLimit = { max: 120, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  const one = kind, many = `${kind}s`, Noun = kind === "guide" ? "Guide" : "Area", noun = kind === "guide" ? "guide" : "area";
  app.use("*", requireUser(db));
  // Guides auto-save (at most one save every 2 s per tab); areas save on a button.
  app.use("*", saveLimit(limit));

  const view = (r: Row, by: string | null) => ({
    id: r.id, ...snapshot(r), status: r.status, live: r.published != null, hasChanges: hasChanges(r),
    version: r.version, updatedAt: r.updatedAt, updatedBy: by
  });
  const idOf = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);
  const ofKind = (id: number) => and(eq(articles.id, id), eq(articles.type, kind));

  app.get("/", async (c) => {
    const rows = await db.select({ row: articles, by: users.name }).from(articles).leftJoin(users, eq(users.id, articles.updatedBy))
      .where(eq(articles.type, kind)).orderBy(kind === "area" ? asc(articles.id) : desc(articles.updatedAt));
    return c.json({ [many]: rows.map(({ row, by }) => { const { blocks: _b, ...v } = view(row, by); return v; }) });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
    const base = slugify(title);
    const msg = kind === "guide" ? "Give the guide a title." : "Give the area a name.";
    if (!title || title.length > 120 || !base) return c.json({ error: msg, errors: { title: msg } }, 422);
    const user = c.get("user");
    const taken = new Set((await db.select({ slug: articles.slug }).from(articles).where(eq(articles.type, kind))).map((r) => r.slug));
    let slug = base;
    // "-2", "-3"… within the 80-character limit and without a double hyphen.
    for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 80 - String(n).length - 1).replace(/-+$/, "")}-${n}`;
    const [row] = await db.insert(articles).values({
      type: kind, slug, title, summary: "", areaSlug: null, publishedDate: kind === "guide" ? new Date().toISOString().slice(0, 10) : null,
      blocks: STARTER[kind], status: "draft", authorId: user.id, updatedBy: user.id
    }).onConflictDoNothing().returning();
    if (!row) return c.json({ error: `Someone just created ${kind === "guide" ? "a guide" : "an area"} with the same title. Try again.` }, 409);
    await audit(db, { userId: user.id, action: `${kind}_created`, entityType: "article", entityId: row.id });
    return c.json({ [one]: view(row, user.name) }, 201);
  });

  app.get("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    const [r] = id ? await db.select({ row: articles, by: users.name }).from(articles).leftJoin(users, eq(users.id, articles.updatedBy)).where(ofKind(id)) : [];
    if (!r) return c.json({ error: `${Noun} not found.` }, 404);
    const areas = await areaList(db);
    const full = kind === "guide" ? validateGuide(snapshot(r.row), new Set(areas.map((a) => a.slug)), doc()) : validateArea(snapshot(r.row), doc());
    const extra = kind === "guide"
      ? { areas }
      : { guides: (await guidesOf(db, r.row.slug)).map(({ published, ...g }) => ({ ...g, live: published != null })) };
    return c.json({
      [one]: view(r.row, r.by), ...extra,
      template: await template(siteFilesRoot, kind, (r.row.published as Guide | null)?.slug),
      problems: full.ok ? {} : full.errors
    });
  });

  app.put("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: `${Noun} not found.` }, 404);
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion)) return c.json({ error: `Invalid ${noun} data.` }, 400);
    let g: Guide;
    if (kind === "guide") {
      const check = validateGuide(body, new Set((await areaList(db)).map((a) => a.slug)), doc(), { partial: true });
      if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);
      g = check.guide;
    } else {
      const check = validateArea(body, doc(), { partial: true });
      if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);
      g = { ...check.area, areaSlug: "", publishedDate: "" };
    }
    const user = c.get("user");

    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.select().from(articles).where(ofKind(id)).for("update");
        if (!row) return c.json({ error: `${Noun} not found.` }, 404);
        if (row.version !== body.baseVersion) {
          const [by] = row.updatedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
          return c.json({ error: `This ${noun} was changed by ${by?.name ?? "someone else"} at ${row.updatedAt.toISOString()}. Reload to see their changes.`, version: row.version }, 409);
        }
        if (row.published && g.slug !== row.slug) return c.json({ error: "Some fields need fixing.", errors: { slug: `This ${noun} is live, so its address can't change (links to it would break).` } }, 422);
        if (g.slug !== row.slug) {
          const [clash] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.type, kind), eq(articles.slug, g.slug), ne(articles.id, id)));
          if (clash) return c.json({ error: "Some fields need fixing.", errors: { slug: `Another ${noun} already uses this address.` } }, 422);
          // A draft area's guides follow it to its new address. Their version moves on, so an open guide editor sees
          // the change (its next save asks to reload instead of sending the old area).
          if (kind === "area") {
            const moved = await tx.update(articles).set({ areaSlug: g.slug, version: sql`${articles.version} + 1`, updatedAt: new Date() })
              .where(and(eq(articles.type, "guide"), eq(articles.areaSlug, row.slug))).returning({ id: articles.id });
            if (moved.length) await audit(tx as unknown as Db, { userId: user.id, action: "area_renamed", entityType: "article", entityId: id, detail: { from: row.slug, to: g.slug, guides: moved.map((m) => m.id) } });
          }
        }
        // A guide's area is re-checked inside the transaction (shared lock), so an area renamed or deleted at the same
        // moment can't leave the guide pointing at a missing area.
        if (kind === "guide" && g.areaSlug) {
          const [ok] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.type, "area"), eq(articles.slug, g.areaSlug))).for("share");
          if (!ok) return c.json({ error: "Some fields need fixing.", errors: { areaSlug: "This process area no longer exists. Choose another one." } }, 422);
        }

        const [saved] = await tx.update(articles).set({
          slug: g.slug, title: g.title, summary: g.summary, areaSlug: g.areaSlug || null, publishedDate: g.publishedDate || row.publishedDate, blocks: g.blocks,
          seoTitle: g.seo.title, seoDescription: g.seo.description, noindex: g.seo.noindex,
          version: row.version + 1, updatedBy: user.id, updatedAt: new Date()
        }).where(eq(articles.id, id)).returning();

        // One revision per editing session: only if the last one is old or by someone else.
        const [last] = await tx.select().from(revisions).where(and(eq(revisions.entityType, "article"), eq(revisions.entityId, id)))
          .orderBy(desc(revisions.createdAt), desc(revisions.id)).limit(1);
        if (!last || last.userId !== user.id || Date.now() - last.createdAt.getTime() > REVISION_GAP_MS) {
          await tx.insert(revisions).values({ entityType: "article", entityId: id, userId: user.id, note: "Edited", snapshot: snapshot(saved!) });
          await audit(tx as unknown as Db, { userId: user.id, action: `${kind}_edited`, entityType: "article", entityId: id });
        }
        return c.json({ version: saved!.version, hasChanges: hasChanges(saved!), updatedAt: saved!.updatedAt, [one]: view(saved!, user.name) });
      });
    } catch (e) {
      // Two saves can pass the slug check at the same moment; the unique index then refuses the second one.
      if ((e as { code?: string } | null)?.code === "23505") return c.json({ error: "Some fields need fixing.", errors: { slug: `Another ${noun} already uses this address.` } }, 422);
      throw e;
    }
  });

  app.delete("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: `${Noun} not found.` }, 404);
    const user = c.get("user");
    // Checked under a row lock, so a publish can't slip in between the check and the delete.
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(articles).where(ofKind(id)).for("update");
      if (!row) return c.json({ error: `${Noun} not found.` }, 404);
      if (row.published || row.status !== "draft") return c.json({ error: `Only drafts that were never published can be deleted. Live ${many} are taken down in the Publish centre.` }, 409);
      if (kind === "area") {
        const [used] = await tx.select({ n: count() }).from(articles).where(and(eq(articles.type, "guide"), eq(articles.areaSlug, row.slug)));
        const n = used?.n ?? 0;
        if (n > 0) return c.json({ error: `${n} guide${n === 1 ? "" : "s"} still belong${n === 1 ? "s" : ""} to this area. Move ${n === 1 ? "it" : "them"} to another area first.` }, 409);
      }
      await tx.delete(revisions).where(and(eq(revisions.entityType, "article"), eq(revisions.entityId, id)));
      await tx.delete(articles).where(eq(articles.id, id));
      await audit(tx as unknown as Db, { userId: user.id, action: `${kind}_deleted`, entityType: "article", entityId: id, detail: { slug: row.slug, title: row.title } });
      return c.json({ ok: true });
    });
  });

  return app;
}
