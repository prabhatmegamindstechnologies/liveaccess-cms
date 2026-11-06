import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { articles, auditLog, pages, redirects } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, siteFilesRoot: env.siteRoot });
const siteFile = (f: string) => readFileSync(join(env.siteRoot, f), "utf8").replace(/\r\n/g, "\n");

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
});

async function signIn(email = "editor@example.com", name = "Test User", role: "super_admin" | "editor" = "super_admin") {
  const { password } = await makeUser(db, { email, role });
  if (name !== "Test User") await db.execute(sql`update users set name = ${name} where email = ${email}`);
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  const get = async () => (await app().request(`${api}/seo`, { headers: { authorization } })).json();
  const put = (part: string, body: unknown) =>
    app().request(`${api}/seo/${part}`, { method: "PUT", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { get, put };
}

const content = async () => {
  const p = await db.select({ h: pages.html, l: pages.publishedHtml }).from(pages).orderBy(pages.id);
  const a = await db.select({ b: articles.blocks }).from(articles).orderBy(articles.id);
  return JSON.stringify([p, a]);
};

describe("SEO API", () => {
  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/seo`)).status).toBe(401);
  });

  it("starts from today's files and the home page, and generates the sitemap", async () => {
    const { get } = await signIn();
    const s = await get();
    expect(s.robots).toMatchObject({ value: siteFile("robots.txt"), version: 1 });
    expect(s.llms).toMatchObject({ value: siteFile("llms.txt"), version: 1 });
    expect(s.defaults.value).toEqual({ description: expect.stringContaining("TPS"), shareImage: "logo.png", cardType: "summary" });
    expect(s.redirects).toMatchObject({ value: [], version: 1 });
    expect(s.sitemap.count).toBe(26);
    expect(s.sitemap.xml).toContain("<loc>https://liveaccess.ai/</loc>");
    expect(s.sitemap.xml).toContain("<loc>https://liveaccess.ai/area-spray-drying.html</loc>");
    expect(s.links).toContainEqual({ group: "Pages", label: "FAQ", href: "faq.html" });
  });

  it("leaves noindex pages and draft articles out of the sitemap", async () => {
    await db.update(pages).set({ noindex: true }).where(eq(pages.key, "delete-account"));
    await db.update(articles).set({ status: "draft" }).where(eq(articles.slug, "evaporator-fouling"));
    const { get } = await signIn();
    const s = await get();
    expect(s.sitemap.count).toBe(24);
    expect(s.sitemap.xml).not.toContain("delete-account.html");
    expect(s.sitemap.xml).not.toContain("guide-evaporator-fouling.html");
  });

  it("saves redirects, robots, llms and defaults as drafts without touching pages", async () => {
    const before = await content();
    const { get, put } = await signIn("asha@example.com", "Asha Rao");
    const s = await get();

    const rules = [{ from: "/old-faq", to: "faq.html", code: 301 }, { from: "/promo", to: "https://tps.ltd/", code: 302 }];
    const r1 = await put("redirects", { baseVersion: s.redirects.version, value: rules });
    expect(r1.status).toBe(200);
    expect((await db.select().from(redirects)).map((r) => [r.fromPath, r.toPath, r.code])).toEqual([["/old-faq", "faq.html", 301], ["/promo", "https://tps.ltd/", 302]]);

    const robots = s.robots.value.replace("Allow: /\n", "Allow: /\nDisallow: /drafts/\n");
    expect((await put("robots", { baseVersion: 1, value: robots })).status).toBe(200);
    expect((await put("llms", { baseVersion: 1, value: "# LiveAccess 24/7\n\nShort." })).status).toBe(200);
    expect((await put("defaults", { baseVersion: 1, value: { ...s.defaults.value, cardType: "summary_large_image" } })).status).toBe(200);

    const after = await get();
    expect(after.redirects).toMatchObject({ value: rules, version: 2, updatedBy: "Asha Rao" });
    expect(after.robots).toMatchObject({ value: robots, version: 2 });
    expect(after.llms.value).toBe("# LiveAccess 24/7\n\nShort.");
    expect(after.defaults.value.cardType).toBe("summary_large_image");
    expect(await content()).toBe(before);
    expect((await db.select().from(auditLog)).map((a) => a.action).filter((a) => a.startsWith("seo_")).sort()).toEqual(["seo_defaults_edited", "seo_llms_edited", "seo_redirects_edited", "seo_robots_edited"]);
  });

  it("replaces the redirect list on each save (edit and delete)", async () => {
    const { put } = await signIn();
    await put("redirects", { baseVersion: 1, value: [{ from: "/a", to: "faq.html", code: 301 }, { from: "/b", to: "about.html", code: 301 }] });
    const res = await put("redirects", { baseVersion: 2, value: [{ from: "/b", to: "features.html", code: 302 }] });
    expect(res.status).toBe(200);
    expect((await db.select().from(redirects)).map((r) => [r.fromPath, r.toPath, r.code])).toEqual([["/b", "features.html", 302]]);
  });

  it("returns field errors and saves nothing on bad input", async () => {
    const { put } = await signIn();
    const bad = await put("redirects", { baseVersion: 1, value: [{ from: "/a", to: "https://liveaccess.ai/a", code: 301 }, { from: "/faq.html", to: "faq.html", code: 301 }] });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(["0.to", "1.from"]);
    expect(await db.select().from(redirects)).toHaveLength(0);

    const robots = await put("robots", { baseVersion: 1, value: "User-agent: *\nDisallow: /\nSitemap: https://liveaccess.ai/sitemap.xml" });
    expect(robots.status).toBe(422);
    expect((await robots.json()).errors.value).toMatch(/whole site/);
    expect((await put("llms", { baseVersion: 1, value: "" })).status).toBe(422);
    expect((await put("defaults", { baseVersion: 1, value: { cardType: "big" } })).status).toBe(422);
    expect((await put("nope", { baseVersion: 1, value: "" })).status).toBe(404);
    for (const part of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect((await put(part, { baseVersion: 1, value: "x" })).status, part).toBe(404);
    }
    const r404 = await put("redirects", { baseVersion: 1, value: [{ from: "/404.html", to: "faq.html", code: 301 }] });
    expect(r404.status).toBe(422);
    expect((await put("robots", { value: "x" })).status).toBe(400);
  });

  it("refuses a save based on an old version and names who changed it", async () => {
    const a = await signIn("asha@example.com", "Asha Rao");
    const b = await signIn("ben@example.com", "Ben Ode");
    const s = await a.get();
    expect((await a.put("llms", { baseVersion: 1, value: s.llms.value + "\n" })).status).toBe(200);
    const res = await b.put("llms", { baseVersion: 1, value: s.llms.value });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed by Asha Rao/);
  });
});

describe("Editors and SEO", () => {
  it("can read it, but only a Super Admin can save any part", async () => {
    const { get, put } = await signIn("reader@example.com", "Test User", "editor");
    const data = await get();
    expect(data.canEdit).toBe(false);
    for (const part of ["redirects", "robots", "llms", "defaults"]) {
      expect((await put(part, { baseVersion: data[part].version, value: data[part].value })).status, part).toBe(403);
    }
  });
});
