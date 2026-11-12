// /<ADMIN_PATH>/api/audit — read the audit log (Super Admin only). There's nothing here to change or delete entries.
import { Hono } from "hono";
import { and, asc, count, desc, eq, gte, inArray, lt, notInArray, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { articles, auditLog, pages, users } from "../../db/schema.ts";
import { requireFreshUser, requireSuperAdmin, type FreshAuthVars } from "../auth/require-user.ts";

const PAGE_SIZE = 50;

// Routine sign-ins fill the log, so they only show under their own filter. Failed ones always show.
const ROUTINE = ["login", "logout"];
// Editors see these on the Dashboard too, so only add actions about pages, guides and areas.
export const CONTENT_ACTIONS = ["page_edited", "page_restored", "guide_created", "guide_edited", "guide_deleted", "area_created", "area_edited", "area_deleted", "area_renamed"];
const GROUPS: Record<string, string[]> = {
  content: [...CONTENT_ACTIONS, "media_uploaded", "media_edited", "media_replaced", "media_deleted"],
  website: ["menus_edited", "site_settings_edited", "seo_redirects_edited", "seo_robots_edited", "seo_llms_edited", "seo_defaults_edited"],
  users: ["user_created", "user_edited", "user_password_reset", "user_unlocked", "password_changed", "password_change_failed", "own_password_failed"],
  publishing: ["preview_built"],
  messages: ["message_deleted", "messages_purged"],
  "sign-ins": ["login", "logout", "login_failed", "login_locked"]
};
// `detail` can hold anything a route logged; only these reach the screen (never emailHash).
const SHOWN = ["fields", "role", "status", "email", "title", "slug", "from", "to", "pages", "guides", "areas", "files", "passwordSource", "name", "reason", "count"];
const SECTIONS: Record<string, string> = { menus: "/menus", seo: "/seo", settings: "/settings", publish: "/publish", message: "/inbox" };

type Row = { action: string; entityType: string | null; entityId: string | null; detail: unknown };

const date = (s: string | undefined) => {
  if (s === undefined) return undefined;
  const d = new Date(s);
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s) && !Number.isNaN(d.getTime()) ? d : null;
};
const shownDetail = (detail: unknown) => {
  const d = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
  return Object.fromEntries(SHOWN.filter((k) => k in d).map((k) => [k, d[k]]));
};

/** The titles of the items the entries are about, looked up now so they show current names. */
export async function itemsFor(db: Db, rows: Row[]) {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))];
  const numbers = (list: string[]) => list.filter((s) => /^\d{1,9}$/.test(s)).map(Number);
  const pageIds = ids("page"), articleIds = numbers(ids("article")), userIds = numbers(ids("user"));
  const [ps, as, us] = await Promise.all([
    pageIds.length ? db.select({ key: pages.key, title: pages.title }).from(pages).where(inArray(pages.key, pageIds)) : [],
    articleIds.length ? db.select({ id: articles.id, type: articles.type, title: articles.title }).from(articles).where(inArray(articles.id, articleIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : []
  ]);
  const page = new Map(ps.map((p) => [p.key, p])), article = new Map(as.map((a) => [String(a.id), a])), user = new Map(us.map((u) => [String(u.id), u]));

  return (r: Row): { title: string; link: string | null } | null => {
    const id = r.entityId ?? "";
    if (r.entityType === "page" && page.has(id)) return { title: page.get(id)!.title, link: `/pages/${id}` };
    if (r.entityType === "article" && article.has(id)) {
      const a = article.get(id)!;
      return { title: a.title, link: `/${a.type}s/${id}` };
    }
    if (r.entityType === "user" && user.has(id)) return { title: user.get(id)!.name, link: "/users" };
    const section = r.entityType && Object.hasOwn(SECTIONS, r.entityType) ? SECTIONS[r.entityType] : undefined;
    if (section) return { title: "", link: section };
    // Deleted since: the entry may have kept the title.
    const title = (r.detail as { title?: unknown } | null)?.title;
    return typeof title === "string" ? { title, link: null } : null;
  };
}

export function auditRoutes(db: Db) {
  const app = new Hono<{ Variables: FreshAuthVars }>();
  app.use("*", requireFreshUser(db));
  app.use("*", requireSuperAdmin);

  app.get("/", async (c) => {
    const q = c.req.query();
    const page = q.page === undefined ? 1 : /^[1-9]\d{0,6}$/.test(q.page) ? Number(q.page) : null;
    const user = q.user === undefined ? undefined : /^\d{1,9}$/.test(q.user) ? Number(q.user) : null;
    const group = q.group === undefined ? undefined : Object.hasOwn(GROUPS, q.group) ? GROUPS[q.group]! : null;
    const from = date(q.from), to = date(q.to);
    if (page === null || user === null || group === null || from === null || to === null) return c.json({ error: "Invalid filter." }, 400);

    const filters: SQL[] = [group ? inArray(auditLog.action, group) : notInArray(auditLog.action, ROUTINE)];
    if (user !== undefined) filters.push(eq(auditLog.userId, user));
    if (from) filters.push(gte(auditLog.createdAt, from));
    if (to) filters.push(lt(auditLog.createdAt, to));
    const where = and(...filters);

    const [rows, [total], people] = await Promise.all([
      db.select({ entry: auditLog, name: users.name, email: users.email }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(auditLog).where(where),
      db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name), asc(users.id))
    ]);
    const item = await itemsFor(db, rows.map((r) => r.entry));

    return c.json({
      entries: rows.map(({ entry: e, name, email }) => ({
        id: e.id, action: e.action, at: e.createdAt, ip: e.ip, detail: shownDetail(e.detail), item: item(e),
        who: e.userId && name ? { id: e.userId, name, email } : null
      })),
      total: total?.n ?? 0, page, pageSize: PAGE_SIZE, users: people
    });
  });

  return app;
}
