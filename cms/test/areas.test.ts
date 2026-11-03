import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { articles, auditLog, pages } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, siteFilesRoot: env.siteRoot });

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
});

async function signIn(email = "editor@example.com", name = "Test User") {
  const { password } = await makeUser(db, { email, role: "editor" });
  if (name !== "Test User") await db.execute(sql`update users set name = ${name} where email = ${email}`);
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { csrfToken } = await res.json();
  const req = (method: string, path: string, body?: unknown, csrf: string | null = csrfToken) =>
    app().request(`${api}${path}`, { method, headers: { cookie, "content-type": "application/json", ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (method: string, path: string, body?: unknown) => (await req(method, path, body)).json();
  return { req, json };
}

const idOf = async (type: "area" | "guide", slug: string) => (await db.select({ id: articles.id }).from(articles).where(and(eq(articles.type, type), eq(articles.slug, slug))))[0]!.id;
const fields = (a: Record<string, unknown>) => ({ slug: a.slug, title: a.title, summary: a.summary, blocks: a.blocks, seo: a.seo });
const pageHtml = async () => JSON.stringify(await db.select({ h: pages.html, l: pages.publishedHtml }).from(pages).orderBy(pages.id));

describe("areas API", () => {
  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/areas`)).status).toBe(401);
  });

  it("lists the 8 areas as live, in their order, without unpublished changes", async () => {
    const { json } = await signIn();
    const { areas } = await json("GET", "/areas");
    expect(areas.map((a: { slug: string }) => a.slug)).toEqual(["applications", "automation", "evaporation", "high-shear-mixing", "ingredients", "liquid-processing", "powder-handling", "spray-drying"]);
    expect(areas[2]).toMatchObject({ title: "Evaporation", status: "published", live: true, hasChanges: false });
  });

  it("opens an area with its template, its guides and nothing missing", async () => {
    const { json } = await signIn();
    const r = await json("GET", `/areas/${await idOf("area", "high-shear-mixing")}`);
    expect(r.area).toMatchObject({ slug: "high-shear-mixing", title: "High shear mixing", version: 1, live: true });
    expect(r.template).toContain(`<section class="cta-band dark">`);
    expect(r.guides.map((g: { slug: string }) => g.slug).sort()).toEqual(["high-shear-mixer-seal-leak", "powder-lumps-in-mixing"]);
    expect(r.problems).toEqual({});
  });

  it("saves edits as a draft with unpublished changes, leaving pages and guides alone", async () => {
    const before = await pageHtml();
    const { json, req } = await signIn("asha@example.com", "Asha Rao");
    const id = await idOf("area", "evaporation");
    const { area } = await json("GET", `/areas/${id}`);
    const res = await req("PUT", `/areas/${id}`, { baseVersion: 1, ...fields(area), summary: "Evaporators concentrate liquids.", areaSlug: "nope", publishedDate: "x" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, hasChanges: true });
    const after = await json("GET", `/areas/${id}`);
    expect(after.area).toMatchObject({ summary: "Evaporators concentrate liquids.", updatedBy: "Asha Rao", hasChanges: true, areaSlug: "", publishedDate: "" });
    expect(await pageHtml()).toBe(before);
    expect((await db.select().from(auditLog)).map((a) => a.action)).toContain("area_edited");
  });

  it("creates a draft area that guides can use; its guides follow a slug change; delete waits for them", async () => {
    const { json, req } = await signIn();
    const created = await req("POST", "/areas", { title: "Dairy desserts" });
    expect(created.status).toBe(201);
    const { area } = await created.json();
    expect(area).toMatchObject({ slug: "dairy-desserts", status: "draft", live: false });

    // The guide editor offers the new area.
    const guideId = await idOf("guide", "evaporator-fouling");
    const { guide, areas } = await json("GET", `/guides/${guideId}`);
    expect(areas).toContainEqual({ slug: "dairy-desserts", name: "Dairy desserts" });
    const g = await req("PUT", `/guides/${guideId}`, { baseVersion: guide.version, slug: guide.slug, title: guide.title, summary: guide.summary, areaSlug: "dairy-desserts", publishedDate: guide.publishedDate, blocks: guide.blocks, seo: guide.seo });
    expect(g.status).toBe(200);

    // Renaming the draft area's address takes its guide along.
    const moved = await req("PUT", `/areas/${area.id}`, { baseVersion: area.version, ...fields(area), slug: "desserts" });
    expect(moved.status).toBe(200);
    const after = (await db.select({ a: articles.areaSlug, v: articles.version }).from(articles).where(eq(articles.id, guideId)))[0]!;
    expect(after.a).toBe("desserts");
    // The guide's version moves on (an open editor must reload) and the move is in the audit log.
    expect(after.v).toBe(guide.version + 2);
    expect((await db.select().from(auditLog)).map((l) => l.action)).toContain("area_renamed");

    const blocked = await req("DELETE", `/areas/${area.id}`);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/1 guide still belongs/);

    const g2 = await json("GET", `/guides/${guideId}`);
    await req("PUT", `/guides/${guideId}`, { baseVersion: g2.guide.version, slug: g2.guide.slug, title: g2.guide.title, summary: g2.guide.summary, areaSlug: "evaporation", publishedDate: g2.guide.publishedDate, blocks: g2.guide.blocks, seo: g2.guide.seo });
    expect((await req("DELETE", `/areas/${area.id}`)).status).toBe(200);
  });

  it("protects live areas and refuses bad input and old versions", async () => {
    const a = await signIn("asha@example.com", "Asha Rao");
    const b = await signIn("ben@example.com", "Ben Ode");
    const id = await idOf("area", "spray-drying");
    const { area } = await a.json("GET", `/areas/${id}`);
    expect((await a.req("PUT", `/areas/${id}`, { baseVersion: 1, ...fields(area), slug: "drying" })).status).toBe(422);
    expect((await a.req("DELETE", `/areas/${id}`)).status).toBe(409);
    const bad = await a.req("PUT", `/areas/${id}`, { baseVersion: 1, ...fields(area), blocks: [{ type: "table" }] });
    expect(bad.status).toBe(422);
    expect((await a.req("PUT", `/areas/${id}`, { baseVersion: 1, ...fields(area), title: "Spray drying (SD)" })).status).toBe(200);
    const late = await b.req("PUT", `/areas/${id}`, { baseVersion: 1, ...fields(area) });
    expect(late.status).toBe(409);
    expect((await late.json()).error).toMatch(/changed by Asha Rao/);
    // An area id isn't a guide, and the other way round.
    expect((await a.req("GET", `/guides/${id}`)).status).toBe(404);
  });
});
