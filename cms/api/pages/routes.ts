// /<ADMIN_PATH>/api/pages — list, open, save draft (with version check), history and restore.
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { pages, revisions, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { checkPageHtml } from "./guard.ts";

const REVISION_GAP_MS = 10 * 60 * 1000;
const CANONICAL = /^https:\/\/liveaccess\.ai\/[a-z0-9\-./]*$/;

type SeoInput = { title: string; description: string; canonical: string; noindex: boolean };

function parseSeo(v: unknown): SeoInput | null | "invalid" {
  if (v == null) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.title !== "string" || typeof s.description !== "string" || typeof s.canonical !== "string" || typeof s.noindex !== "boolean") return "invalid";
  if (s.title.length > 200 || s.description.length > 500) return "invalid";
  if (s.canonical !== "" && !CANONICAL.test(s.canonical)) return "invalid";
  return { title: s.title.trim(), description: s.description.trim(), canonical: s.canonical, noindex: s.noindex };
}

const changed = sql<boolean>`${pages.html} is distinct from ${pages.publishedHtml}`;

export type SaveLimit = { max: number; windowMs: number };

export function pageRoutes(db: Db, limit: SaveLimit = { max: 120, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));

  // Per-user save limit (auto-save sends at most one save every 2 s per tab). In-memory, per server instance;
  // a shared limiter comes with the Day 6 rate limits.
  const recent = new Map<number, number[]>();
  app.use("*", async (c, next) => {
    if (c.req.method === "GET") return next();
    const id = c.get("user").id, now = Date.now();
    const hits = (recent.get(id) ?? []).filter((t) => now - t < limit.windowMs);
    if (hits.length >= limit.max) return c.json({ error: "Too many saves. Wait a moment and try again." }, 429);
    hits.push(now);
    recent.set(id, hits);
    await next();
  });

  app.get("/", async (c) => {
    const rows = await db
      .select({ key: pages.key, title: pages.title, url: pages.url, version: pages.version, updatedAt: pages.updatedAt, updatedBy: users.name, hasChanges: changed })
      .from(pages)
      .leftJoin(users, eq(users.id, pages.updatedBy))
      .orderBy(pages.id);
    return c.json({ pages: rows });
  });

  app.get("/:key", async (c) => {
    const [p] = await db
      .select({ page: pages, updatedBy: users.name, hasChanges: changed })
      .from(pages)
      .leftJoin(users, eq(users.id, pages.updatedBy))
      .where(eq(pages.key, c.req.param("key")));
    if (!p) return c.json({ error: "Page not found." }, 404);
    const { page } = p;
    return c.json({
      page: {
        key: page.key, title: page.title, url: page.url, html: page.html, version: page.version,
        hasChanges: p.hasChanges, updatedAt: page.updatedAt, updatedBy: p.updatedBy,
        seo: { title: page.seoTitle, description: page.seoDescription, canonical: page.canonical, noindex: page.noindex }
      }
    });
  });

  app.put("/:key", async (c) => {
    const body = await c.req.json().catch(() => null);
    const baseVersion = body?.baseVersion;
    const html = body?.html;
    const seo = parseSeo(body?.seo);
    if (!Number.isInteger(baseVersion) || (html !== undefined && typeof html !== "string") || seo === "invalid" || (html === undefined && !seo)) {
      return c.json({ error: "Invalid page data." }, 400);
    }
    const user = c.get("user");

    return db.transaction(async (tx) => {
      const [page] = await tx.select().from(pages).where(eq(pages.key, c.req.param("key"))).for("update");
      if (!page) return c.json({ error: "Page not found." }, 404);
      if (page.version !== baseVersion) {
        const [by] = page.updatedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, page.updatedBy)) : [];
        const at = page.updatedAt.toISOString();
        return c.json({ error: `This page was changed by ${by?.name ?? "someone else"} at ${at}. Reload to see their changes.`, version: page.version, updatedBy: by?.name ?? null, updatedAt: at }, 409);
      }
      if (html !== undefined) {
        const problem = checkPageHtml(html, page.publishedHtml ?? page.html);
        if (problem) return c.json({ error: problem }, 422);
      }

      const [saved] = await tx.update(pages).set({
        ...(html !== undefined ? { html } : {}),
        ...(seo ? { seoTitle: seo.title, seoDescription: seo.description, canonical: seo.canonical, noindex: seo.noindex } : {}),
        version: page.version + 1,
        updatedBy: user.id,
        updatedAt: new Date()
      }).where(eq(pages.id, page.id)).returning();

      // One revision per editing session: only if the last one is old or by someone else.
      const [last] = await tx.select().from(revisions)
        .where(and(eq(revisions.entityType, "page"), eq(revisions.entityId, page.id)))
        .orderBy(desc(revisions.createdAt), desc(revisions.id)).limit(1);
      if (!last || last.userId !== user.id || Date.now() - last.createdAt.getTime() > REVISION_GAP_MS) {
        await tx.insert(revisions).values({
          entityType: "page", entityId: page.id, userId: user.id, note: "Edited",
          snapshot: { html: saved!.html, seo: { title: saved!.seoTitle, description: saved!.seoDescription, canonical: saved!.canonical, noindex: saved!.noindex } }
        });
        await audit(tx as unknown as Db, { userId: user.id, action: "page_edited", entityType: "page", entityId: page.key });
      }
      return c.json({ version: saved!.version, hasChanges: saved!.html !== saved!.publishedHtml, updatedAt: saved!.updatedAt });
    });
  });

  app.get("/:key/revisions", async (c) => {
    const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.key, c.req.param("key")));
    if (!page) return c.json({ error: "Page not found." }, 404);
    const rows = await db
      .select({ id: revisions.id, note: revisions.note, createdAt: revisions.createdAt, by: users.name })
      .from(revisions).leftJoin(users, eq(users.id, revisions.userId))
      .where(and(eq(revisions.entityType, "page"), eq(revisions.entityId, page.id)))
      .orderBy(desc(revisions.createdAt), desc(revisions.id)).limit(100);
    return c.json({ revisions: rows });
  });

  app.post("/:key/revisions/:id/restore", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion)) return c.json({ error: "Invalid request." }, 400);
    const user = c.get("user");
    return db.transaction(async (tx) => {
      const [page] = await tx.select().from(pages).where(eq(pages.key, c.req.param("key"))).for("update");
      if (!page) return c.json({ error: "Page not found." }, 404);
      if (page.version !== body.baseVersion) return c.json({ error: "This page was changed meanwhile. Reload and try again.", version: page.version }, 409);
      const [rev] = await tx.select().from(revisions).where(and(eq(revisions.id, Number(c.req.param("id"))), eq(revisions.entityType, "page"), eq(revisions.entityId, page.id)));
      const snap = rev?.snapshot as { html?: string } | undefined;
      if (!rev || typeof snap?.html !== "string") return c.json({ error: "Version not found." }, 404);
      const problem = checkPageHtml(snap.html, page.publishedHtml ?? page.html);
      if (problem) return c.json({ error: `This version can't be restored: ${problem}` }, 422);
      const [saved] = await tx.update(pages).set({ html: snap.html, version: page.version + 1, updatedBy: user.id, updatedAt: new Date() }).where(eq(pages.id, page.id)).returning();
      await tx.insert(revisions).values({ entityType: "page", entityId: page.id, userId: user.id, note: `Restored version from ${rev.createdAt.toISOString().slice(0, 16).replace("T", " ")}`, snapshot: { html: snap.html } });
      await audit(tx as unknown as Db, { userId: user.id, action: "page_restored", entityType: "page", entityId: page.key, detail: { revisionId: rev.id } });
      return c.json({ version: saved!.version, hasChanges: saved!.html !== saved!.publishedHtml });
    });
  });

  return app;
}
