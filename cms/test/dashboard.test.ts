import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, ne } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { audit } from "../api/audit.ts";
import { importSite } from "../import/site.ts";
import { articles, contactMessages, pages, publishJobs, users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true });
const json = { "content-type": "application/json" };

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
});

async function signIn(email = "admin@example.com", role: "super_admin" | "editor" = "super_admin") {
  const { password, user } = await makeUser(db, { email, role });
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const get = (path = "/dashboard") => app().request(`${api}${path}`, { headers: { cookie } });
  return { get, read: async (path = "/dashboard") => (await get(path)).json(), id: user.id };
}
const slug = (s: string) => db.select().from(articles).where(eq(articles.slug, s)).then((r) => r[0]!);

describe("who can open it", () => {
  it("needs a sign-in, and is open to Editors", async () => {
    expect((await app().request(`${api}/dashboard`)).status).toBe(401);
    expect((await (await signIn("editor@example.com", "editor")).get()).status).toBe(200);
  });

  it("waits for a forced password change", async () => {
    const editor = await signIn("editor@example.com", "editor");
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, editor.id));
    expect((await editor.get()).status).toBe(403);
  });
});

describe("waiting to be published", () => {
  it("is empty when everything is published", async () => {
    const body = await (await signIn()).read();
    expect(body.waiting).toEqual({ items: [], total: 0, newDrafts: 0 });
  });

  it("labels never-published items New and edited live items Changed, with links", async () => {
    const admin = await signIn();
    const guide = await slug("evaporator-fouling"), area = await slug("evaporation");
    await db.update(articles).set({ published: null }).where(eq(articles.id, guide.id));
    await db.update(articles).set({ summary: "Edited summary" }).where(eq(articles.id, area.id));
    await db.update(pages).set({ html: "<html>edited</html>", updatedBy: admin.id }).where(eq(pages.key, "about"));

    const { waiting } = await admin.read();
    expect(waiting.total).toBe(3);
    expect(waiting.newDrafts).toBe(1);
    const by = (link: string) => waiting.items.find((i: { link: string }) => i.link === link);
    expect(by(`/guides/${guide.id}`)).toMatchObject({ kind: "guide", state: "new", title: guide.title });
    expect(by(`/areas/${area.id}`)).toMatchObject({ kind: "area", state: "changed", title: area.title });
    expect(by("/pages/about")).toMatchObject({ kind: "page", state: "changed", title: "About us", by: "Test User" });
  });

  it("counts the same items as the Pages, guides and areas lists", async () => {
    const admin = await signIn();
    await db.update(articles).set({ summary: "Edited" }).where(eq(articles.slug, "evaporator-fouling"));
    await db.update(pages).set({ publishedHtml: null }).where(eq(pages.key, "about"));
    const [p, g, a] = await Promise.all([admin.read("/pages"), admin.read("/guides"), admin.read("/areas")]);
    const changed = (list: { hasChanges: boolean }[]) => list.filter((r) => r.hasChanges).length;
    expect((await admin.read()).waiting.total).toBe(changed(p.pages) + changed(g.guides) + changed(a.areas));
  });

  it("shows the 10 most recently edited, with the full total", async () => {
    const admin = await signIn();
    const list = await db.select().from(pages).where(ne(pages.key, "home"));
    expect(list.length).toBeGreaterThan(10);
    for (const [i, p] of list.entries()) {
      await db.update(pages).set({ html: `${p.html}<!-- ${i} -->`, updatedAt: new Date(Date.UTC(2026, 0, 1 + i)) }).where(eq(pages.id, p.id));
    }
    const { waiting } = await admin.read();
    expect(waiting.total).toBe(list.length);
    expect(waiting.items).toHaveLength(10);
    expect(waiting.items[0].link).toBe(`/pages/${list.at(-1)!.key}`);
  });
});

describe("recent activity", () => {
  it("shows content edits only, newest first", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "page_edited", entityType: "page", entityId: "about" });
    await audit(db, { userId: admin.id, action: "user_edited", entityType: "user", entityId: admin.id });
    await audit(db, { userId: admin.id, action: "menus_edited", entityType: "menus", entityId: "site" });
    await audit(db, { userId: admin.id, action: "login_failed", entityType: "user" });
    await audit(db, { userId: admin.id, action: "guide_deleted", entityType: "article", entityId: 9999, detail: { title: "Old guide" } });
    const { activity } = await admin.read();
    expect(activity.map((e: { action: string }) => e.action)).toEqual(["guide_deleted", "page_edited"]);
    expect(activity[0].item).toEqual({ title: "Old guide", link: null });
    expect(activity[1]).toMatchObject({ who: "Test User", item: { title: "About us", link: "/pages/about" } });
  });

  it("never gives an Editor an IP address, an email or the entry's detail", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "page_edited", entityType: "page", entityId: "about", ip: "203.0.113.9", detail: { emailHash: "abc123", fields: ["secret-field"] } });
    const text = await (await (await signIn("editor@example.com", "editor")).get()).text();
    for (const hidden of ["203.0.113.9", "admin@example.com", "abc123", "secret-field", "\"ip\"", "\"detail\""]) expect(text).not.toContain(hidden);
    expect(text).toContain("page_edited");
  });

  it("gives an Editor nothing from sign-ins, user changes, messages or publish logs", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "login_failed", entityType: "user", ip: "203.0.113.9" });
    await audit(db, { userId: admin.id, action: "user_edited", entityType: "user", entityId: admin.id, detail: { email: "changed@example.com" } });
    await audit(db, { userId: admin.id, action: "guide_deleted", entityType: "article", entityId: 9999, ip: "203.0.113.9", detail: { title: "Old guide", slug: "hidden-slug" } });
    await db.insert(contactMessages).values({ name: "Ann Sender", email: "ann@example.com", message: "Private question" });
    await db.insert(publishJobs).values({ status: "done", log: "secret log", items: ["secret-item"] });

    const text = await (await (await signIn("editor@example.com", "editor")).get()).text();
    for (const hidden of ["login_failed", "user_edited", "/users", "203.0.113.9", "changed@example.com", "hidden-slug", "Ann Sender", "ann@example.com", "Private question", "secret log", "secret-item"]) {
      expect(text).not.toContain(hidden);
    }
    expect(text).toContain("Old guide");
  });

  it("stops at 10 entries", async () => {
    const admin = await signIn();
    for (let i = 0; i < 12; i++) await audit(db, { userId: admin.id, action: "page_edited", entityType: "page", entityId: "about" });
    expect((await admin.read()).activity).toHaveLength(10);
  });
});

describe("messages and last publish", () => {
  it("shows none before those features are used", async () => {
    const body = await (await signIn()).read();
    expect(body.messages).toBe(0);
    expect(body.lastPublish).toBeNull();
  });

  it("counts only new messages and never returns their content", async () => {
    const admin = await signIn();
    await db.insert(contactMessages).values([
      { name: "Ann", email: "ann@example.com", message: "Private question" },
      { name: "Ben", email: "ben@example.com", message: "Read already", status: "read" }
    ]);
    const res = await admin.get();
    const text = await res.text();
    expect(JSON.parse(text).messages).toBe(1);
    expect(text).not.toContain("ann@example.com");
    expect(text).not.toContain("Private question");
  });

  it("shows the latest publish", async () => {
    const admin = await signIn();
    const finishedAt = new Date("2026-11-02T10:00:00Z");
    await db.insert(publishJobs).values([
      { status: "failed", startedAt: new Date("2026-11-01T10:00:00Z") },
      { status: "done", startedAt: new Date("2026-11-02T09:59:00Z"), finishedAt, log: "secret log" }
    ]);
    expect((await admin.read()).lastPublish).toEqual({ status: "done", at: finishedAt.toISOString() });
  });
});
