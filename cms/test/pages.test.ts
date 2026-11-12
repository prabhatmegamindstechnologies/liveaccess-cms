import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { importSite } from "../import/site.ts";
import { pages, revisions } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";
import { parseHTML } from "linkedom";
import { addItem, buildFields, richField, serialize, splitScripts, writeField } from "@liveaccess/shared";

let db: Db;
let close: () => Promise<void>;
const api = "http://local/la-studio/api";
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, siteRoot: env.siteRoot });

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
});

async function signIn(email = "admin@example.com", name = "Test User") {
  const { password } = await makeUser(db, { email, role: email.startsWith("admin") ? "super_admin" : "editor" });
  if (name !== "Test User") await db.execute(sql`update users set name = ${name} where email = ${email}`);
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  const get = (path: string) => app().request(`${api}${path}`, { headers: { authorization } });
  const send = (method: string, path: string, body: unknown) =>
    app().request(`${api}${path}`, { method, headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { get, send };
}

async function aboutPage() {
  const [p] = await db.select().from(pages).where(eq(pages.key, "about"));
  return p!;
}

describe("pages API", () => {
  it("needs a signed-in user", async () => {
    expect((await app().request(`${api}/pages`)).status).toBe(401);
    expect((await app().request(`${api}/pages/about`)).status).toBe(401);
  });

  it("lists the 12 imported pages without unpublished changes", async () => {
    const { get } = await signIn();
    const res = await get("/pages");
    expect(res.status).toBe(200);
    const { pages: list } = await res.json();
    expect(list).toHaveLength(12);
    expect(list.find((p: { key: string }) => p.key === "privacy")).toMatchObject({ title: "Privacy policy", hasChanges: false, version: 1 });
  });

  it("opens one page with its draft HTML and SEO fields", async () => {
    const { get } = await signIn();
    const { page } = await (await get("/pages/about")).json();
    expect(page.html).toContain("Built by the people behind");
    expect(page.seo).toMatchObject({ title: "About LiveAccess — Built by TPS" });
    expect((await get("/pages/nope")).status).toBe(404);
  });

  it("saves a draft without touching the live version", async () => {
    const { send, get } = await signIn("editor@example.com");
    const before = await aboutPage();
    const html = before.html.replace("your process lines.", "your plant.");
    const res = await send("PUT", "/pages/about", { baseVersion: 1, html });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, hasChanges: true });
    const after = await aboutPage();
    expect(after.html).toContain("your plant.");
    expect(after.publishedHtml).toBe(before.publishedHtml);
    const { pages: list } = await (await get("/pages")).json();
    expect(list.find((p: { key: string }) => p.key === "about").hasChanges).toBe(true);
  });

  it("refuses a save based on an old version and says who changed it", async () => {
    const a = await signIn("admin@example.com", "Akash");
    const html = (await aboutPage()).html;
    expect((await a.send("PUT", "/pages/about", { baseVersion: 1, html: html.replace("TPS", "TPS Ltd") })).status).toBe(200);
    const b = await signIn("editor@example.com", "Prabhat");
    const res = await b.send("PUT", "/pages/about", { baseVersion: 1, html });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/changed by Akash/);
    expect(body.version).toBe(2);
  });

  it.each([
    ["an added script", (h: string) => h.replace("</body>", "<script>alert(1)</script></body>"), /Scripts/],
    ["a removed Google Analytics tag", (h: string) => h.replace(/<script[^>]*googletagmanager[^>]*><\/script>/, ""), /Scripts/],
    ["an onclick attribute", (h: string) => h.replace("<h1>", '<h1 onclick="steal()">'), /event attributes/i],
    ["a javascript: link", (h: string) => h.replace('href="contact.html"', 'href="javascript:alert(1)"'), /javascript/],
    ["a changed <head> (new stylesheet)", (h: string) => h.replace("</head>", '<link rel="stylesheet" href="https://evil.example/x.css"></head>'), /head/]
  ])("refuses page HTML with %s", async (_name, change, message) => {
    const { send } = await signIn();
    const html = change((await aboutPage()).html);
    const res = await send("PUT", "/pages/about", { baseVersion: 1, html });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(message);
  });

  it.each([
    ["a script closed with </script x>", (h: string) => h.replace("</body>", '<script src="//evil.example/x.js"></script x></body>')],
    ["a <base> in the body", (h: string) => h.replace('<body class="site">', '<body class="site"><base href="https://evil.example/">')],
    ["an iframe with srcdoc", (h: string) => h.replace("<h1>", '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><h1>')],
    ["an iframe with a data: URL", (h: string) => h.replace("<h1>", '<iframe src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"></iframe><h1>')],
    ["an <object data=javascript:>", (h: string) => h.replace("<h1>", '<object data="javascript:alert(1)"></object><h1>')],
    ["an SVG <set> to a javascript: link", (h: string) => h.replace("<h1>", '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg><h1>')],
    ["a meta refresh in the body", (h: string) => h.replace("<h1>", '<meta http-equiv="refresh" content="0;url=https://evil.example"><h1>')],
    ["a page script switched off inside a comment", (h: string) => h.replace(/(<script src="menu\.js[^"]*"><\/script>)/, "<!--$1-->")],
    ["a fake script marker", (h: string) => h.replace("<h1>", "<!--cms-script:0--><h1>")],
    ["a data: image", (h: string) => h.replace('src="logo.png"', 'src="data:image/svg+xml,%3Csvg onload=alert(1)%3E"')],
    ["a new inline style", (h: string) => h.replace("<h1>", '<h1 style="background:url(https://evil.example/leak)">')],
    ["a text style on a layout element", (h: string) => h.replace("<h1>", '<h1 style="color:#C2410C">')],
    ["a text style on a div", (h: string) => h.replace("<h1>", '<div style="font-size:18px">x</div><h1>')],
    ["a text style not in its stored form", (h: string) => h.replace("<h1>", '<h1><span style="color:#c2410c">x</span>')],
    ["a text style with an extra property", (h: string) => h.replace("<h1>", '<h1><span style="color:#C2410C;position:fixed">x</span>')],
    ["a font off the list", (h: string) => h.replace("<h1>", `<h1><span style="font-family:'Comic Sans MS'">x</span>`)],
    ["a style with url()", (h: string) => h.replace("<h1>", '<h1><u style="background-color:url(https://evil.example/x)">x</u>')],
    ["alignment in a text field", (h: string) => h.replace("<h1>", '<h1><span style="text-align:center">x</span>')]
  ])("refuses page HTML with %s", async (_name, change) => {
    const { send } = await signIn();
    const html = change((await aboutPage()).html);
    expect(html).not.toBe((await aboutPage()).html);
    const res = await send("PUT", "/pages/about", { baseVersion: 1, html });
    expect(res.status).toBe(422);
  });

  it("still accepts normal editing done with the shared field tools", async () => {
    const { send } = await signIn();
    for (const [key, file] of [["about", "about.html"], ["how-it-works", "how-it-works.html"], ["home", "index.html"], ["privacy", "privacy-policy.html"], ["contact", "contact.html"], ["faq", "faq.html"]]) {
      const [p] = await db.select().from(pages).where(eq(pages.key, key!));
      const { html: stripped, scripts } = splitScripts(p!.html);
      const { document } = parseHTML(stripped);
      const fields = buildFields(document);
      writeField(fields.find((f) => f.type === "text")!, "Edited <em>text</em>");
      const withItem = fields.find((f) => f.item);
      if (withItem) addItem(withItem);
      const res = await send("PUT", `/pages/${key}`, { baseVersion: p!.version, html: serialize(document, scripts) });
      expect(res.status, `${file}: ${await res.clone().text()}`).toBe(200);
    }
  });

  it("accepts the text editor's formatting in text fields, cleaned to the allow-list", async () => {
    const { send } = await signIn();
    const styled = `<span style="color:#C2410C;font-size:18px;font-family:Georgia,serif">Hot</span> <u>water</u> <s>old</s> <strong style="background-color:#FFF1EA">b</strong>`;
    for (const key of ["faq", "privacy"]) {
      const [p] = await db.select().from(pages).where(eq(pages.key, key));
      const { html: stripped, scripts } = splitScripts(p!.html);
      const { document } = parseHTML(stripped);
      const fields = buildFields(document);
      const targets = fields.filter((f) => richField(f)).slice(0, 5);
      expect(targets.length).toBe(5);
      for (const f of targets) writeField(f, `${styled}<span style="position:fixed" onclick="x">y</span><p style="text-align:center">z</p>`);
      const html = serialize(document, scripts);
      expect(html).not.toMatch(/position:fixed|onclick="x"|text-align:center/);
      const res = await send("PUT", `/pages/${key}`, { baseVersion: p!.version, html });
      expect(res.status, `${key}: ${await res.clone().text()}`).toBe(200);
    }
  });

  it("keeps short labels plain", async () => {
    const [p] = await db.select().from(pages).where(eq(pages.key, "faq"));
    const { document } = parseHTML(splitScripts(p!.html).html);
    const fields = buildFields(document);
    const button = fields.find((f) => f.label === "Button text")!;
    expect(richField(button)).toBe(false);
    writeField(button, `<span style="color:#C2410C">Go</span>`);
    expect(button.el.innerHTML).toBe("<span>Go</span>");
    expect(richField(fields.find((f) => f.label === "Main heading")!)).toBe(true);
  });

  it("limits how often one person can save", async () => {
    const limited = createApp({ db, adminPath: "la-studio", secureCookies: true, siteRoot: env.siteRoot, pageSaveLimit: { max: 2, windowMs: 60_000 } });
    const { password } = await makeUser(db, { email: "fast@example.com" });
    const login = await limited.request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "fast@example.com", password }) });
    const authorization = `Bearer ${(await login.json()).accessToken}`;
    const put = (v: number) => limited.request(`${api}/pages/about`, { method: "PUT", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ baseVersion: v, seo: { title: "t", description: "d", canonical: "", noindex: false } }) });
    expect((await put(1)).status).toBe(200);
    expect((await put(2)).status).toBe(200);
    expect((await put(3)).status).toBe(429);
  });

  it("allows a changed <title> and meta description in the HTML", async () => {
    const { send } = await signIn();
    const html = (await aboutPage()).html.replace("<title>About LiveAccess — Built by TPS</title>", "<title>About us</title>");
    expect((await send("PUT", "/pages/about", { baseVersion: 1, html })).status).toBe(200);
  });

  it("saves SEO fields", async () => {
    const { send } = await signIn();
    const res = await send("PUT", "/pages/about", { baseVersion: 1, seo: { title: "About TPS", description: "Who we are.", canonical: "", noindex: true } });
    expect(res.status).toBe(200);
    expect(await aboutPage()).toMatchObject({ seoTitle: "About TPS", seoDescription: "Who we are.", noindex: true, version: 2 });
  });

  it("rejects a canonical URL outside liveaccess.ai", async () => {
    const { send } = await signIn();
    const res = await send("PUT", "/pages/about", { baseVersion: 1, seo: { title: "x", description: "y", canonical: "https://evil.example/", noindex: false } });
    expect(res.status).toBe(400);
  });

  it("writes one revision for quick auto-saves by the same person", async () => {
    const { send } = await signIn();
    const html = (await aboutPage()).html;
    await send("PUT", "/pages/about", { baseVersion: 1, html: html.replace("TPS", "TPS 1") });
    await send("PUT", "/pages/about", { baseVersion: 2, html: html.replace("TPS", "TPS 2") });
    await send("PUT", "/pages/about", { baseVersion: 3, html: html.replace("TPS", "TPS 3") });
    const id = (await aboutPage()).id;
    const rows = await db.select().from(revisions).where(sql`${revisions.entityType} = 'page' and ${revisions.entityId} = ${id}`);
    expect(rows).toHaveLength(2); // the import + one for this editing session
  });

  it("lists revisions and restores one as the draft", async () => {
    const { send, get } = await signIn();
    const original = (await aboutPage()).html;
    await send("PUT", "/pages/about", { baseVersion: 1, html: original.replace("TPS", "TPS changed") });
    const { revisions: list } = await (await get("/pages/about/revisions")).json();
    const imported = list.find((r: { note: string }) => r.note === "Imported from the site files");
    const res = await send("POST", `/pages/about/revisions/${imported.id}/restore`, { baseVersion: 2 });
    expect(res.status).toBe(200);
    expect((await aboutPage()).html).toBe(original);
  });
});

describe("preview assets", () => {
  it("serves the site's CSS and images without a token: <link> and <img> can't send one", async () => {
    const get = (path: string) => app().request(`${api}${path}`);
    const css = await get("/preview-assets/common.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toMatch(/text\/css/);
    expect((await get("/preview-assets/images/how-step-1.webp")).status).toBe(200);
  });

  it("refuses anything outside the allowed asset types and folders", async () => {
    const { get } = await signIn();
    for (const p of ["/preview-assets/../package.json", "/preview-assets/%2e%2e/.env", "/preview-assets/.env", "/preview-assets/cms/env.ts", "/preview-assets/about.html", "/preview-assets/..%5Cpackage.json"]) {
      expect((await get(p)).status, p).toBe(404);
    }
  });

  it("returns 404 (not 500) for a malformed path and sandboxes SVG", async () => {
    const { get } = await signIn();
    expect((await get("/preview-assets/%E0.css")).status).toBe(404);
    const svg = await get("/preview-assets/app-qr.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is not mounted without a site root (production)", async () => {
    const prod = createApp({ db, adminPath: "la-studio", secureCookies: true });
    const { password } = await makeUser(db, { email: "p@example.com" });
    const login = await prod.request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "p@example.com", password }) });
    const authorization = `Bearer ${(await login.json()).accessToken}`;
    expect((await prod.request(`${api}/preview-assets/common.css`, { headers: { authorization } })).status).toBe(404);
  });
});
