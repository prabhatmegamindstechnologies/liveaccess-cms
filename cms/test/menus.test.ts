import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { auditLog, menus, pages } from "../db/schema.ts";
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

async function signIn(email = "editor@example.com", name = "Test User", role: "super_admin" | "editor" = "super_admin") {
  const { password } = await makeUser(db, { email, role });
  if (name !== "Test User") await db.execute(sql`update users set name = ${name} where email = ${email}`);
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { csrfToken } = await res.json();
  const get = () => app().request(`${api}/menus`, { headers: { cookie } });
  const put = (body: unknown, csrf: string | null = csrfToken) =>
    app().request(`${api}/menus`, { method: "PUT", headers: { cookie, "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: JSON.stringify(body) });
  return { get, put };
}

const pageHtml = async () => (await db.select({ html: pages.html, live: pages.publishedHtml }).from(pages).orderBy(pages.id)).map((p) => p.html + p.live).join("");

describe("menus API", () => {
  it("needs a signed-in user and the CSRF token", async () => {
    expect((await app().request(`${api}/menus`)).status).toBe(401);
    const { put, get } = await signIn();
    const { menus: m, version } = await (await get()).json();
    expect((await put({ baseVersion: version, menus: m }, null)).status).toBe(403);
  });

  it("starts from the menus on the live home page and lists the site's pages", async () => {
    const { get } = await signIn();
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.menus.header.links.map((l: { label: string }) => l.label)).toEqual(["How it works", "Features", "About", "Contact"]);
    expect(body.menus.header.button).toEqual({ label: "Get the app", href: "get-app.html" });
    expect(body.menus.footer.map((c: { heading: string }) => c.heading)).toEqual(["Product", "Resources", "Company"]);
    expect(body.hasChanges).toBe(false);
    const options = body.links as { group: string; label: string; href: string }[];
    expect(options).toContainEqual({ group: "Pages", label: "Home", href: "./" });
    expect(options).toContainEqual({ group: "Pages", label: "FAQ", href: "faq.html" });
    expect(options.find((o) => o.href === "guide-evaporator-fouling.html")?.group).toBe("Troubleshooting guides");
    expect(options.find((o) => o.href === "area-spray-drying.html")?.group).toBe("Process areas");
  });

  it("saves a draft, bumps the version, logs it and leaves every page untouched", async () => {
    const before = await pageHtml();
    const { get, put } = await signIn("editor@example.com", "Asha Rao");
    const { menus: m, version } = await (await get()).json();
    m.header.links.reverse();
    m.footer[1].links.push({ label: "TPS website", href: "https://tps.ltd/" });

    const res = await put({ baseVersion: version, menus: m });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, hasChanges: true });

    const after = await (await get()).json();
    expect(after.menus).toEqual(m);
    expect(after).toMatchObject({ version: 2, updatedBy: "Asha Rao", hasChanges: true });
    expect(await pageHtml()).toBe(before);
    const logged = await db.select().from(auditLog);
    expect(logged.map((l) => l.action)).toContain("menus_edited");
  });

  it("refuses a save based on an old version and names who changed it", async () => {
    const a = await signIn("asha@example.com", "Asha Rao");
    const b = await signIn("ben@example.com", "Ben Ode");
    const { menus: m, version } = await (await a.get()).json();
    expect((await a.put({ baseVersion: version, menus: m })).status).toBe(200);
    const res = await b.put({ baseVersion: version, menus: m });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed by Asha Rao/);
  });

  it("turns two simultaneous first saves into one save and one conflict", async () => {
    const a = await signIn("asha@example.com", "Asha Rao");
    const b = await signIn("ben@example.com", "Ben Ode");
    const { menus: m } = await (await a.get()).json();
    const codes = (await Promise.all([a.put({ baseVersion: 1, menus: m }), b.put({ baseVersion: 1, menus: m })])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
  });

  it("returns field errors for bad links and limits", async () => {
    const { get, put } = await signIn();
    const { menus: m, version } = await (await get()).json();
    m.header.links[0].href = "javascript:alert(1)";
    m.footer[2].heading = "";
    const res = await put({ baseVersion: version, menus: m });
    expect(res.status).toBe(422);
    const { errors } = await res.json();
    expect(Object.keys(errors).sort()).toEqual(["footer.2.heading", "header.links.0.href"]);
    expect((await db.select().from(menus)).length).toBe(0);
  });

  it("rejects malformed requests", async () => {
    const { put } = await signIn();
    expect((await put({ menus: {} })).status).toBe(400);
    expect((await put({ baseVersion: 1, menus: "x" })).status).toBe(422);
  });
});

describe("Editors and the menus", () => {
  it("can read them, but only a Super Admin can save", async () => {
    const { get, put } = await signIn("reader@example.com", "Test User", "editor");
    const { menus: m, version, canEdit } = await (await get()).json();
    expect(canEdit).toBe(false);
    expect((await put({ baseVersion: version, menus: m })).status).toBe(403);
    expect(await db.select().from(menus)).toEqual([]);
  });
});
