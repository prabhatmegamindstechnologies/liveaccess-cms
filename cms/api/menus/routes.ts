// /<ADMIN_PATH>/api/menus — the draft header and footer menus. Saving never touches page HTML: the Publish centre
// applies the menus to every page later.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { readMenus, validateMenus, type Menus } from "@liveaccess/shared";
import type { Db } from "../../db/client.ts";
import { articles, menus, pages, users } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { requireSuperAdmin, requireUser, type AuthVars } from "../auth/require-user.ts";
import { saveLimit, type SaveLimit } from "../save-limit.ts";

const LOCATION = "site";
type LinkOption = { group: string; label: string; href: string };

/** Links a menu can point to: the site's pages, guides and process areas (as the relative links the pages use). */
async function linkOptions(db: Db): Promise<LinkOption[]> {
  const ps = await db.select({ title: pages.title, url: pages.url, key: pages.key }).from(pages).orderBy(pages.id);
  const as = await db.select({ type: articles.type, slug: articles.slug, title: articles.title }).from(articles).orderBy(articles.type, articles.id);
  return [
    ...ps.map((p) => ({ group: "Pages", label: p.title, href: p.url === "/" ? "./" : p.url.replace(/^\//, "") })),
    ...as.map((a) => ({ group: a.type === "guide" ? "Troubleshooting guides" : "Process areas", label: a.title, href: `${a.type}-${a.slug}.html` }))
  ];
}

/** The menus on the live site, read from the home page. */
async function liveMenus(db: Db): Promise<Menus> {
  const [home] = await db.select({ html: pages.html, live: pages.publishedHtml }).from(pages).where(eq(pages.key, "home"));
  if (!home) throw new Error("The home page is missing.");
  return readMenus(home.live ?? home.html);
}

const same = (a: Menus, b: Menus) => JSON.stringify(a) === JSON.stringify(b);

export function menuRoutes(db: Db, limit: SaveLimit = { max: 30, windowMs: 60_000 }) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use("*", requireUser(db));
  app.use("*", saveLimit(limit));

  app.get("/", async (c) => {
    const live = await liveMenus(db);
    const [row] = await db.select({ menu: menus, by: users.name }).from(menus).leftJoin(users, eq(users.id, menus.updatedBy)).where(eq(menus.location, LOCATION));
    const draft = (row?.menu.items as Menus | undefined) ?? live;
    return c.json({
      menus: draft,
      version: row?.menu.version ?? 1,
      updatedAt: row?.menu.updatedAt ?? null,
      updatedBy: row?.by ?? null,
      hasChanges: !same(draft, live),
      links: await linkOptions(db),
      canEdit: c.get("user").role === "super_admin"
    });
  });

  app.put("/", requireSuperAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Number.isInteger(body?.baseVersion) || body?.menus === undefined) return c.json({ error: "Invalid menu data." }, 400);
    const user = c.get("user");
    const live = await liveMenus(db);
    const known = new Set((await linkOptions(db)).map((o) => o.href));
    const check = validateMenus(body.menus, known, live.footer.length);
    if (!check.ok) return c.json({ error: "Some fields need fixing.", errors: check.errors }, 422);

    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(menus).where(eq(menus.location, LOCATION)).for("update");
      const version = row?.version ?? 1;
      if (version !== body.baseVersion) {
        const [by] = row?.updatedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, row.updatedBy)) : [];
        const at = row?.updatedAt.toISOString() ?? "";
        return c.json({ error: `The menus were changed by ${by?.name ?? "someone else"} at ${at}. Reload to see their changes.`, version, updatedBy: by?.name ?? null, updatedAt: at }, 409);
      }
      const values = { items: check.menus, version: version + 1, updatedBy: user.id, updatedAt: new Date() };
      // With no row yet there is nothing to lock: a simultaneous first save may insert first. Then this one conflicts.
      const [saved] = row
        ? await tx.update(menus).set(values).where(eq(menus.id, row.id)).returning()
        : await tx.insert(menus).values({ location: LOCATION, ...values }).onConflictDoNothing({ target: menus.location }).returning();
      if (!saved) return c.json({ error: "The menus were just changed by someone else. Reload to see their changes.", version: 2 }, 409);
      await audit(tx as unknown as Db, { userId: user.id, action: "menus_edited", entityType: "menus", entityId: LOCATION });
      return c.json({ version: saved!.version, updatedAt: saved!.updatedAt, hasChanges: !same(check.menus, live), menus: check.menus });
    });
  });

  return app;
}
