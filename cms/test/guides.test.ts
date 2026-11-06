import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { articles, auditLog, pages, revisions } from "../db/schema.ts";
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
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  const req = (method: string, path: string, body?: unknown) =>
    app().request(`${api}/guides${path}`, { method, headers: { authorization, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (method: string, path: string, body?: unknown) => (await req(method, path, body)).json();
  return { req, json };
}

const guideId = async (slug: string) => (await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug)))[0]!.id;
const pageHtml = async () => JSON.stringify(await db.select({ h: pages.html, l: pages.publishedHtml }).from(pages).orderBy(pages.id));
const fields = (g: Record<string, unknown>) => ({ slug: g.slug, title: g.title, summary: g.summary, areaSlug: g.areaSlug, publishedDate: g.publishedDate, blocks: g.blocks, seo: g.seo });

describe("guides API", () => {
  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/guides`)).status).toBe(401);
  });

  it("lists the 6 imported guides as live without unpublished changes", async () => {
    const { json } = await signIn();
    const { guides } = await json("GET", "");
    expect(guides).toHaveLength(6);
    expect(guides.find((g: { slug: string }) => g.slug === "evaporator-fouling")).toMatchObject({ status: "published", live: true, hasChanges: false, areaSlug: "evaporation" });
  });

  it("opens a guide with the page template, areas and nothing missing", async () => {
    const { json } = await signIn();
    const { guide, template, areas, problems } = await json("GET", `/${await guideId("evaporator-fouling")}`);
    expect(guide).toMatchObject({ slug: "evaporator-fouling", title: "Evaporator fouling and falling capacity: causes and checks", version: 1, live: true });
    expect(guide.blocks).toHaveLength(12);
    expect(template).toContain(`<article class="article">`);
    expect(areas).toContainEqual({ slug: "evaporation", name: "Evaporation" });
    expect(areas).toHaveLength(8);
    expect(problems).toEqual({});
  });

  it("auto-saves edits as a draft: unpublished changes, revision, audit, pages untouched", async () => {
    const before = await pageHtml();
    const { json, req } = await signIn("asha@example.com", "Asha Rao");
    const id = await guideId("evaporator-fouling");
    const { guide } = await json("GET", `/${id}`);
    const res = await req("PUT", `/${id}`, { baseVersion: 1, ...fields(guide), title: "Evaporator fouling: what to check", blocks: [...guide.blocks, { type: "paragraph", html: "New <em>tip</em>." }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, hasChanges: true });
    const after = await json("GET", `/${id}`);
    expect(after.guide).toMatchObject({ title: "Evaporator fouling: what to check", version: 2, updatedBy: "Asha Rao", hasChanges: true });
    expect(after.guide.blocks.at(-1)).toEqual({ type: "paragraph", html: "New <em>tip</em>." });
    expect(await pageHtml()).toBe(before);
    expect((await db.select().from(revisions).where(eq(revisions.entityId, id))).length).toBeGreaterThanOrEqual(2);
    expect((await db.select().from(auditLog)).map((a) => a.action)).toContain("guide_edited");
  });

  it("creates a draft with a slug from the title, keeps unfinished drafts, and deletes drafts", async () => {
    const { json, req } = await signIn();
    const created = await req("POST", "", { title: "Pump cavitation: quick checks!" });
    expect(created.status).toBe(201);
    const { guide } = await created.json();
    expect(guide).toMatchObject({ slug: "pump-cavitation-quick-checks", status: "draft", live: false });
    const again = await json("POST", "", { title: "Pump cavitation: quick checks!" });
    expect(again.guide.slug).toBe("pump-cavitation-quick-checks-2");

    // An unfinished draft saves fine and lists what is missing before publishing.
    const save = await req("PUT", `/${guide.id}`, { baseVersion: guide.version, ...fields(guide), summary: "", slug: "pump-cavitation", blocks: [{ type: "heading", level: 2, text: "" }] });
    expect(save.status).toBe(200);
    const opened = await json("GET", `/${guide.id}`);
    expect(opened.guide.slug).toBe("pump-cavitation");
    expect(Object.keys(opened.problems)).toEqual(expect.arrayContaining(["summary", "blocks.0"]));

    expect((await req("DELETE", `/${guide.id}`)).status).toBe(200);
    expect((await req("GET", `/${guide.id}`)).status).toBe(404);
  });

  it("keeps numbered slugs valid for long titles", async () => {
    const { json } = await signIn();
    const title = `${"Very long guide title words ".repeat(4)}end`.slice(0, 118);
    const a = (await json("POST", "", { title })).guide.slug as string;
    const b = (await json("POST", "", { title })).guide.slug as string;
    expect(b).not.toBe(a);
    for (const s of [a, b]) {
      expect(s.length).toBeLessThanOrEqual(80);
      expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("protects live guides: no slug change, no delete, no duplicate slug", async () => {
    const { json, req } = await signIn();
    const id = await guideId("evaporator-fouling");
    const { guide } = await json("GET", `/${id}`);
    const slug = await req("PUT", `/${id}`, { baseVersion: 1, ...fields(guide), slug: "evaporator-fouling-new" });
    expect(slug.status).toBe(422);
    expect((await slug.json()).errors.slug).toMatch(/live/);
    expect((await req("DELETE", `/${id}`)).status).toBe(409);

    const draft = (await json("POST", "", { title: "Another guide" })).guide;
    const dup = await req("PUT", `/${draft.id}`, { baseVersion: draft.version, ...fields(draft), slug: "evaporator-fouling" });
    expect(dup.status).toBe(422);
    expect((await dup.json()).errors.slug).toMatch(/already/);
  });

  it("refuses unsafe input and old versions", async () => {
    const a = await signIn("asha@example.com", "Asha Rao");
    const b = await signIn("ben@example.com", "Ben Ode");
    const id = await guideId("evaporator-fouling");
    const { guide } = await a.json("GET", `/${id}`);
    const bad = await a.req("PUT", `/${id}`, { baseVersion: 1, ...fields(guide), blocks: [{ type: "quote", text: "x" }], areaSlug: "nope" });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(["areaSlug", "blocks.0"]);
    expect((await a.req("PUT", `/${id}`, { baseVersion: 1, ...fields(guide), title: "A" })).status).toBe(200);
    const late = await b.req("PUT", `/${id}`, { baseVersion: 1, ...fields(guide), title: "B" });
    expect(late.status).toBe(409);
    expect((await late.json()).error).toMatch(/changed by Asha Rao/);
    expect((await a.req("PUT", `/abc`, { baseVersion: 1 })).status).toBe(404);
    expect((await a.req("PUT", `/${id}`, { title: "x" })).status).toBe(400);
    expect((await a.req("POST", "", { title: "" })).status).toBe(422);
  });
});
