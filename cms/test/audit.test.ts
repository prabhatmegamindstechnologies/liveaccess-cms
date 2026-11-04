import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp, loggable } from "../api/app.ts";
import { audit } from "../api/audit.ts";
import { describeAudit } from "../admin/src/lib/audit.ts";
import { importSite } from "../import/site.ts";
import { articles, auditLog } from "../db/schema.ts";
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
  const get = (query = "") => app().request(`${api}/audit${query}`, { headers: { cookie } });
  return { get, list: async (query = "") => (await get(query)).json(), id: user.id };
}
type Entry = { action: string; who: { name: string } | null; item: { title: string; link: string | null } | null; detail: Record<string, unknown>; ip: string | null };
const actions = (r: { entries: Entry[] }) => r.entries.map((e) => e.action);

describe("who can read the log", () => {
  it("needs a signed-in Super Admin", async () => {
    expect((await app().request(`${api}/audit`)).status).toBe(401);
    const editor = await signIn("editor@example.com", "editor");
    expect((await editor.get()).status).toBe(403);
  });
});

describe("GET /audit", () => {
  it("lists entries newest first, with who did it and a link to the item", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "page_edited", entityType: "page", entityId: "about" });
    await audit(db, { userId: admin.id, action: "menus_edited", entityType: "menus", entityId: "site" });
    const { entries } = await admin.list();
    expect(actions({ entries })).toEqual(["menus_edited", "page_edited"]);
    expect(entries[1]).toMatchObject({ who: { name: "Test User" }, item: { title: "About us", link: "/pages/about" } });
    expect(entries[0].item.link).toBe("/menus");
  });

  it("links guides and areas by their current title", async () => {
    const admin = await signIn();
    const [g] = await db.select().from(articles).where(eq(articles.slug, "evaporator-fouling"));
    const [a] = await db.select().from(articles).where(eq(articles.slug, "evaporation"));
    await audit(db, { userId: admin.id, action: "guide_edited", entityType: "article", entityId: g!.id });
    await audit(db, { userId: admin.id, action: "area_edited", entityType: "article", entityId: a!.id });
    const { entries } = await admin.list();
    expect(entries[1].item).toEqual({ title: g!.title, link: `/guides/${g!.id}` });
    expect(entries[0].item).toEqual({ title: a!.title, link: `/areas/${a!.id}` });
  });

  it("still shows entries for a deleted item and an unknown user", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "guide_deleted", entityType: "article", entityId: 9999, detail: { title: "Old guide", slug: "old" } });
    await audit(db, { action: "login_failed", entityType: "user", detail: { emailHash: "abc123" } });
    const { entries } = await admin.list();
    expect(entries[0]).toMatchObject({ action: "login_failed", who: null });
    expect(entries[1].item).toEqual({ title: "Old guide", link: null });
  });

  it("hides routine sign-ins by default, and always shows failed ones", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "logout", entityType: "user", entityId: admin.id });
    await audit(db, { action: "login_failed", entityType: "user" });
    await audit(db, { action: "login_locked", entityType: "user" });
    const shown = actions(await admin.list());
    expect(shown).toEqual(["login_locked", "login_failed"]);
    expect(actions(await admin.list("?group=sign-ins")).sort()).toEqual(["login", "login_failed", "login_locked", "logout"]);
  });

  it("filters by group, user and date", async () => {
    const admin = await signIn();
    const editor = await signIn("editor@example.com", "editor");
    await audit(db, { userId: editor.id, action: "page_edited", entityType: "page", entityId: "about" });
    await audit(db, { userId: admin.id, action: "menus_edited", entityType: "menus", entityId: "site" });
    await audit(db, { userId: admin.id, action: "user_created", entityType: "user", entityId: editor.id });
    await audit(db, { userId: admin.id, action: "preview_built", entityType: "publish", detail: { pages: 12 } });
    expect(actions(await admin.list("?group=content"))).toEqual(["page_edited"]);
    expect(actions(await admin.list("?group=website"))).toEqual(["menus_edited"]);
    expect(actions(await admin.list("?group=users"))).toEqual(["user_created"]);
    expect(actions(await admin.list("?group=publishing"))).toEqual(["preview_built"]);
    expect(actions(await admin.list(`?user=${editor.id}`))).toEqual(["page_edited"]);

    const old = new Date("2026-01-15T10:00:00Z");
    await db.insert(auditLog).values({ userId: admin.id, action: "page_restored", entityType: "page", entityId: "faq", createdAt: old });
    expect(actions(await admin.list("?to=2026-02-01T00:00:00.000Z"))).toEqual(["page_restored"]);
    expect(actions(await admin.list("?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z"))).toEqual([]);
  });

  it("pages through 50 at a time and gives the total", async () => {
    const admin = await signIn();
    await db.insert(auditLog).values(Array.from({ length: 60 }, () => ({ userId: admin.id, action: "page_edited", entityType: "page", entityId: "faq" })));
    const one = await admin.list(), two = await admin.list("?page=2");
    expect(one).toMatchObject({ total: 60, page: 1, pageSize: 50 });
    expect(one.entries).toHaveLength(50);
    expect(two.entries).toHaveLength(10);
  });

  it("refuses bad filters", async () => {
    const admin = await signIn();
    for (const q of ["?page=0", "?page=abc", "?user=x", "?group=nope", "?from=not-a-date", "?to=2026-13-45", "?user=1%27%20or%201=1"]) {
      expect((await admin.get(q)).status, q).toBe(400);
    }
  });

  it("gives only known details, the IP, and the users for the filter", async () => {
    const admin = await signIn();
    await audit(db, { userId: admin.id, action: "user_edited", entityType: "user", entityId: admin.id, ip: "203.0.113.9", detail: { fields: ["name"], emailHash: "abc", secret: "x" } });
    const { entries, users } = await admin.list();
    expect(entries[0].detail).toEqual({ fields: ["name"] });
    expect(entries[0].ip).toBe("203.0.113.9");
    expect(users).toEqual([{ id: admin.id, name: "Test User", email: "admin@example.com" }]);
  });
});

describe("what reaches the server's error log", () => {
  it("leaves out the values of a failed query", () => {
    const failed = new Error('Failed query: update "users" set "password_hash" = $1 params: $argon2id$secret-hash', { cause: Object.assign(new Error("connection lost"), { code: "57P01" }) });
    expect(JSON.stringify(loggable(failed))).not.toContain("argon2");
    expect(loggable(failed)).toMatchObject({ code: "57P01", message: "connection lost" });
  });
  it("keeps other errors whole", () => {
    const plain = new Error("something else");
    expect(loggable(plain)).toBe(plain);
  });
});

describe("describeAudit", () => {
  const entry = (action: string, title?: string, detail: Record<string, unknown> = {}) => ({ action, item: title ? { title, link: null } : null, detail });

  it("gives a plain sentence for every action the CMS records", () => {
    const all = [
      "login", "login_failed", "login_locked", "logout", "page_edited", "page_restored", "guide_created", "guide_edited", "guide_deleted", "area_created", "area_edited",
      "area_deleted", "area_renamed", "menus_edited", "site_settings_edited", "seo_redirects_edited", "seo_robots_edited", "seo_llms_edited", "seo_defaults_edited",
      "preview_built", "user_created", "user_edited", "user_password_reset", "user_unlocked", "password_changed", "password_change_failed", "own_password_failed"
    ];
    for (const a of all) {
      const text = describeAudit(entry(a, "About us"));
      expect(text, a).not.toContain("_");
      expect(text, a).toMatch(/^[A-Z]/);
    }
  });

  it("names the item", () => expect(describeAudit(entry("page_edited", "About us"))).toBe("Edited the page About us"));
  it("says what changed on a user", () => expect(describeAudit(entry("user_edited", "Asha", { status: "disabled" }))).toBe("Disabled Asha"));
  it("never hides an action it doesn't know", () => expect(describeAudit(entry("some_new_action"))).toBe("Some new action"));
  it("copes with an item that's gone", () => expect(describeAudit(entry("page_edited"))).toBe("Edited a page"));
});
