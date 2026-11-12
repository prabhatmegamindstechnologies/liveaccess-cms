// /<ADMIN_PATH>/api/messages — the Contact inbox. Signed-in users read messages and change their status; only a Super
// Admin deletes. Handled messages (replied or archived) are deleted 12 months after their status last changed, as the
// Privacy policy says; that runs when the inbox is opened, at most once an hour per server.
import { Hono } from "hono";
import { and, count, desc, eq, ilike, lt, ne, or, inArray, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.ts";
import { contactMessages, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireSuperAdmin, requireUser, type AuthVars } from "../auth/require-user.ts";
import { CONTACT_TOPICS } from "../contact/routes.ts";

export const MESSAGE_STATUSES = ["new", "read", "replied", "archived"] as const;
type Status = (typeof MESSAGE_STATUSES)[number];
const PAGE_SIZE = 30;
const KEEP_MS = 365 * 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;

const isStatus = (s: unknown): s is Status => typeof s === "string" && (MESSAGE_STATUSES as readonly string[]).includes(s);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export function messageRoutes(db: Db, opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser());
  let lastPurge = 0;

  /** Deletes handled messages 12 months after their status last changed. Logged with the count only. */
  async function purge() {
    if (now() - lastPurge < PURGE_EVERY_MS) return;
    lastPurge = now();
    const gone = await db.delete(contactMessages)
      .where(and(inArray(contactMessages.status, ["replied", "archived"]), lt(contactMessages.statusChangedAt, new Date(now() - KEEP_MS))))
      .returning({ id: contactMessages.id });
    if (gone.length) await audit(db, { action: "messages_purged", entityType: "message", detail: { count: gone.length } });
  }

  const shape = (r: typeof contactMessages.$inferSelect, by: string | null) => ({
    id: r.id, name: r.name, email: r.email, company: r.company, topic: r.topic, message: r.message, page: r.page,
    status: r.status, receivedAt: r.createdAt, statusChangedAt: r.statusChangedAt, statusChangedBy: by
  });

  app.get("/", async (c) => {
    const q = c.req.query();
    const status = q.status ?? "new";
    const page = q.page === undefined ? 1 : /^[1-9]\d{0,5}$/.test(q.page) ? Number(q.page) : null;
    const topic = q.topic ?? "";
    const search = (q.q ?? "").trim();
    if ((status !== "all" && !isStatus(status)) || page === null || (topic && !(CONTACT_TOPICS as readonly string[]).includes(topic)) || search.length > 200) {
      return c.json({ error: "Invalid filter." }, 400);
    }
    await purge();

    const filters: SQL[] = [status === "all" ? ne(contactMessages.status, "archived") : eq(contactMessages.status, status)];
    if (topic) filters.push(eq(contactMessages.topic, topic));
    if (search) {
      const p = like(search);
      filters.push(or(ilike(contactMessages.name, p), ilike(contactMessages.email, p), ilike(contactMessages.company, p), ilike(contactMessages.message, p))!);
    }
    const where = and(...filters);
    const [rows, [total], counts] = await Promise.all([
      db.select({ m: contactMessages, by: users.name }).from(contactMessages).leftJoin(users, eq(users.id, contactMessages.statusChangedBy))
        .where(where).orderBy(desc(contactMessages.createdAt), desc(contactMessages.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(contactMessages).where(where),
      db.select({ status: contactMessages.status, n: count() }).from(contactMessages).groupBy(contactMessages.status)
    ]);
    const byStatus = Object.fromEntries(MESSAGE_STATUSES.map((s) => [s, counts.find((x) => x.status === s)?.n ?? 0])) as Record<Status, number>;
    return c.json({
      messages: rows.map((r) => shape(r.m, r.by)),
      total: total?.n ?? 0, page, pageSize: PAGE_SIZE,
      counts: { ...byStatus, all: byStatus.new + byStatus.read + byStatus.replied },
      topics: CONTACT_TOPICS,
      canDelete: c.get("user").role === "super_admin"
    });
  });

  const idOf = (s: string) => (/^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2_147_483_647 ? Number(s) : null);
  const load = async (id: number) => {
    const [r] = await db.select({ m: contactMessages, by: users.name }).from(contactMessages).leftJoin(users, eq(users.id, contactMessages.statusChangedBy)).where(eq(contactMessages.id, id));
    return r;
  };

  // Opening a new message marks it read.
  app.get("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "Not found." }, 404);
    await db.update(contactMessages).set({ status: "read", statusChangedAt: new Date(now()), statusChangedBy: c.get("user").id })
      .where(and(eq(contactMessages.id, id), eq(contactMessages.status, "new")));
    const r = await load(id);
    return r ? c.json({ message: shape(r.m, r.by) }) : c.json({ error: "Not found." }, 404);
  });

  app.patch("/:id", async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "Not found." }, 404);
    const body = await c.req.json().catch(() => null) as { status?: unknown } | null;
    if (!body || !isStatus(body.status)) return c.json({ error: "Choose new, read, replied or archived." }, 400);
    const done = await db.update(contactMessages).set({ status: body.status, statusChangedAt: new Date(now()), statusChangedBy: c.get("user").id })
      .where(eq(contactMessages.id, id)).returning({ id: contactMessages.id });
    if (!done.length) return c.json({ error: "Not found." }, 404);
    const r = await load(id);
    return c.json({ message: shape(r!.m, r!.by) });
  });

  app.delete("/:id", requireSuperAdmin, async (c) => {
    const id = idOf(c.req.param("id"));
    if (!id) return c.json({ error: "Not found." }, 404);
    const gone = await db.delete(contactMessages).where(eq(contactMessages.id, id)).returning({ id: contactMessages.id });
    if (!gone.length) return c.json({ error: "Not found." }, 404);
    // The id only: the log keeps no name, email or text.
    await audit(db, { userId: c.get("user").id, action: "message_deleted", entityType: "message", entityId: id });
    return c.json({ ok: true });
  });

  return app;
}
