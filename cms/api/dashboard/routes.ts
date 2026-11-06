// /<ADMIN_PATH>/api/dashboard — what needs attention. Read-only and open to Editors, so activity is content edits only,
// with no IP addresses, emails or entry details beyond a deleted item's title (the rest stays in the Super Admin audit log).
import { Hono } from "hono";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { articles, auditLog, contactMessages, pages, publishJobs, users } from "../../db/schema.ts";
import { hasChanges } from "../articles/routes.ts";
import { CONTENT_ACTIONS, itemsFor } from "../audit/routes.ts";
import { requireUser, type AuthVars } from "../auth/require-user.ts";
import { changed } from "../pages/routes.ts";

const SHOWN = 10;

type Waiting = { kind: "page" | "guide" | "area"; title: string; link: string; state: "new" | "changed"; updatedAt: Date; by: string | null };

export function dashboardRoutes(db: Db) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser());

  app.get("/", async (c) => {
    const [pageRows, articleRows, log, [messages], [job]] = await Promise.all([
      db.select({ key: pages.key, title: pages.title, updatedAt: pages.updatedAt, by: users.name, isNew: sql<boolean>`${pages.publishedHtml} is null` })
        .from(pages).leftJoin(users, eq(users.id, pages.updatedBy)).where(changed),
      db.select({ article: articles, by: users.name }).from(articles).leftJoin(users, eq(users.id, articles.updatedBy)),
      db.select({ entry: auditLog, by: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
        .where(inArray(auditLog.action, CONTENT_ACTIONS)).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(SHOWN),
      db.select({ n: count() }).from(contactMessages).where(eq(contactMessages.status, "new")),
      db.select({ status: publishJobs.status, startedAt: publishJobs.startedAt, finishedAt: publishJobs.finishedAt }).from(publishJobs)
        .orderBy(desc(publishJobs.startedAt), desc(publishJobs.id)).limit(1)
    ]);

    const waiting: Waiting[] = [
      ...pageRows.map((p): Waiting => ({ kind: "page", title: p.title, link: `/pages/${p.key}`, state: p.isNew ? "new" : "changed", updatedAt: p.updatedAt, by: p.by })),
      ...articleRows.filter((r) => hasChanges(r.article)).map(({ article: a, by }): Waiting => ({
        kind: a.type, title: a.title, link: `/${a.type}s/${a.id}`, state: a.published ? "changed" : "new", updatedAt: a.updatedAt, by
      }))
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const item = await itemsFor(db, log.map((r) => r.entry));
    return c.json({
      waiting: { items: waiting.slice(0, SHOWN), total: waiting.length, newDrafts: waiting.filter((w) => w.state === "new").length },
      activity: log.map(({ entry: e, by }) => ({ id: e.id, action: e.action, at: e.createdAt, who: by, item: item(e) })),
      messages: messages?.n ?? 0,
      lastPublish: job ? { status: job.status, at: job.finishedAt ?? job.startedAt } : null
    });
  });

  return app;
}
