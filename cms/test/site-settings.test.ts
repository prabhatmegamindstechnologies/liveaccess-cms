import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { articles, auditLog, pages, settings } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true });

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
});

async function signIn(email: string, role: "super_admin" | "editor", name = "Test User") {
  const { password } = await makeUser(db, { email, role });
  if (name !== "Test User") await db.execute(sql`update users set name = ${name} where email = ${email}`);
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  const get = async () => (await app().request(`${api}/settings`, { headers: { authorization } })).json();
  const put = (body: unknown) =>
    app().request(`${api}/settings`, { method: "PUT", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { get, put };
}
const admin = () => signIn("admin@example.com", "super_admin", "Asha Rao");
const editor = () => signIn("editor@example.com", "editor");

const content = async () => JSON.stringify([
  await db.select({ h: pages.html, l: pages.publishedHtml }).from(pages).orderBy(pages.id),
  await db.select({ b: articles.blocks }).from(articles).orderBy(articles.id)
]);

describe("site settings API", () => {
  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/settings`)).status).toBe(401);
  });

  it("starts from the values on the live site", async () => {
    const s = await (await admin()).get();
    expect(s.value).toEqual({
      siteName: "LiveAccess",
      tagline: "The 24/7 service app from TPS for dairy, food and beverage plants.",
      appStore: "https://apps.apple.com/app/liveaccess-24-7/id6790754198",
      playStore: "https://play.google.com/store/apps/details?id=com.liveaccess.app",
      email: "liveaccess@tps.ltd",
      notifyEmail: "",
      ga4: "G-JFHJD3T51M",
      gtm: ""
    });
    expect(s).toMatchObject({ version: 1, canEdit: true });
  });

  it("lets a Super Admin save a draft without touching pages", async () => {
    const before = await content();
    const a = await admin();
    const s = await a.get();
    const value = { ...s.value, tagline: "The 24/7 service app from TPS.", notifyEmail: "alerts@tps.ltd", gtm: "gtm-ab12cd" };
    const res = await a.put({ baseVersion: 1, value });
    expect(res.status).toBe(200);
    const after = await a.get();
    expect(after.value).toMatchObject({ tagline: "The 24/7 service app from TPS.", notifyEmail: "alerts@tps.ltd", gtm: "GTM-AB12CD", ga4: "G-JFHJD3T51M" });
    expect(after).toMatchObject({ version: 2, updatedBy: "Asha Rao" });
    expect(await content()).toBe(before);
    expect((await db.select().from(auditLog)).map((l) => l.action)).toContain("site_settings_edited");
  });

  it("lets an Editor read but not save", async () => {
    const e = await editor();
    const s = await e.get();
    expect(s.canEdit).toBe(false);
    expect(s.value.ga4).toBe("G-JFHJD3T51M");
    const res = await e.put({ baseVersion: 1, value: s.value });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Super Admin/);
    expect(await db.select().from(settings)).toHaveLength(0);
  });

  it("refuses an empty GA4 ID, look-alike store links and bad emails", async () => {
    const a = await admin();
    const s = await a.get();
    const res = await a.put({ baseVersion: 1, value: { ...s.value, ga4: "", appStore: "https://apps.apple.com.evil.test/x", email: "nope" } });
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(["appStore", "email", "ga4"]);
    expect(await db.select().from(settings)).toHaveLength(0);
  });

  it("refuses a save based on an old version and names who changed it", async () => {
    const a = await admin();
    const b = await signIn("ben@example.com", "super_admin", "Ben Ode");
    const s = await a.get();
    expect((await a.put({ baseVersion: 1, value: { ...s.value, siteName: "LiveAccess 24/7" } })).status).toBe(200);
    const res = await b.put({ baseVersion: 1, value: s.value });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed by Asha Rao/);
  });

  it("rejects malformed requests", async () => {
    const a = await admin();
    expect((await a.put({ value: {} })).status).toBe(400);
    expect((await a.put({ baseVersion: 1, value: "x" })).status).toBe(422);
  });
});
