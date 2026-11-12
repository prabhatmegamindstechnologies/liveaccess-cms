import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { applyContactForm, readMenus, type Menus, type SiteSettings } from "@liveaccess/shared";
import { env } from "../env.ts";
import { createApp } from "../api/app.ts";
import { previewSite } from "../api/preview-server.ts";
import { importSite } from "../import/site.ts";
import { buildSite } from "../publish/build-site.ts";
import { articles, auditLog, menus, pages, redirects, settings } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
let previewRoot: string;
const out = (f: string) => join(previewRoot, ".site-preview", f);
const built = (f: string) => readFile(out(f), "utf8");
const source = (f: string) => readFile(join(env.siteRoot, f), "utf8");
/** The page as the build should write it: the site's own file, with the contact form pointed at the CMS (only on contact.html). */
const expected = async (f: string) => (f === "contact.html" ? applyContactForm(await source(f), env.adminPath) : source(f));
const build = () => buildSite(db, { siteRoot: env.siteRoot, previewRoot });
// Some pages write apostrophes as &#x27; inside the article; the sanitiser writes "'". Browsers show both the same.
const same = (s: string) => s.replace(/&#x27;/g, "'");

const liveSettings: SiteSettings = {
  siteName: "LiveAccess",
  tagline: "The 24/7 service app from TPS for dairy, food and beverage plants.",
  appStore: "https://apps.apple.com/app/liveaccess-24-7/id6790754198",
  playStore: "https://play.google.com/store/apps/details?id=com.liveaccess.app",
  email: "liveaccess@tps.ltd", notifyEmail: "", ga4: "G-JFHJD3T51M", gtm: ""
};
const stored = (value: unknown) => ({ value, version: 2, updatedAt: new Date().toISOString(), updatedBy: null });

async function htmlFiles() {
  return (await readdir(env.siteRoot)).filter((f) => f.endsWith(".html"));
}
async function liveMenus() {
  return readMenus(await source("index.html"));
}
async function newGuide(fields: Partial<typeof articles.$inferInsert>) {
  const [g] = await db.select().from(articles).where(eq(articles.slug, "evaporator-fouling"));
  const { id: _id, published: _p, publishedSlug: _s, ...copy } = g!;
  const [row] = await db.insert(articles).values({ ...copy, slug: "new-guide", title: "New guide", status: "draft", ...fields }).returning();
  return row!;
}

beforeAll(async () => {
  ({ db, close } = await testDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await wipe(db);
  await importSite(db, env.siteRoot);
  previewRoot = await mkdtemp(join(tmpdir(), "la-build-"));
});
afterEach(async () => rm(previewRoot, { recursive: true, force: true }));

describe("buildSite", () => {
  it("rebuilds every page of the current site byte-for-byte when there are no drafts", async () => {
    const result = await build();
    for (const f of await htmlFiles()) expect(same(await built(f)), f).toBe(same(await expected(f)));
    expect(result.counts).toMatchObject({ pages: 12, guides: 6, areas: 8 });
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("copies the site's other files, and only those", async () => {
    await build();
    for (const f of ["common.css", "consent.js", "logo.png", "plus-jakarta.woff2", "robots.txt", "llms.txt", ".htaccess", "videocall_demovideo.mp4"]) expect(existsSync(out(f)), f).toBe(true);
    expect((await readdir(out("images"))).length).toBeGreaterThan(0);
    for (const f of ["package.json", ".env", "cms", "docs", "node_modules", "pnpm-lock.yaml"]) expect(existsSync(out(f)), f).toBe(false);
    expect(await built(".htaccess")).toBe(await source(".htaccess"));
  });

  it("changes nothing when every draft setting equals the live site", async () => {
    await db.insert(menus).values({ location: "site", items: await liveMenus() });
    await db.insert(settings).values([
      { key: "site.settings", value: stored(liveSettings) },
      { key: "seo.defaults", value: stored({ description: "x", shareImage: "logo.png", cardType: "summary" }) }
    ]);
    await build();
    for (const f of await htmlFiles()) expect(same(await built(f)), f).toBe(same(await expected(f)));
    expect(await built("consent.js")).toBe(await source("consent.js"));
  });

  it("shows a page's draft text and SEO, and leaves the database as it was", async () => {
    const html = (await source("about.html")).replace("<h1", `<h1 data-draft="yes"`);
    await db.update(pages).set({ html, seoTitle: "Draft title", noindex: true }).where(eq(pages.key, "about"));
    const before = JSON.stringify([await db.select().from(pages).orderBy(pages.id), await db.select().from(articles).orderBy(articles.id), await db.select().from(settings)]);

    await build();

    expect(await built("about.html")).toContain(`data-draft="yes"`);
    expect(await built("about.html")).toContain("<title>Draft title</title>");
    expect(await built("sitemap.xml")).not.toContain("about.html");
    expect(await built("features.html")).toBe(await source("features.html"));
    expect(JSON.stringify([await db.select().from(pages).orderBy(pages.id), await db.select().from(articles).orderBy(articles.id), await db.select().from(settings)])).toBe(before);
  });

  it("leaves out a new draft that isn't ready, and says why", async () => {
    const draft = await newGuide({ title: "Unfinished", summary: "" });
    const result = await build();
    expect(existsSync(out("guide-new-guide.html"))).toBe(false);
    expect(await built("sitemap.xml")).not.toContain("guide-new-guide");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ kind: "guide", id: draft.id, title: "Unfinished", live: false });
    expect(result.skipped[0]!.reason).not.toBe("");
    expect(result.counts.guides).toBe(6);
  });

  it("builds a new finished guide: its page, its card on the area page, the sitemap", async () => {
    await newGuide({ title: "A brand new guide", summary: "First sentence. Second sentence." });
    const result = await build();
    expect(result.skipped).toEqual([]);
    expect(await built("guide-new-guide.html")).toContain("<h1>A brand new guide</h1>");
    expect(await built("sitemap.xml")).toContain("guide-new-guide.html");
    const area = await built("area-evaporation.html");
    expect(area).toContain(`href="guide-new-guide.html"`);
    expect(area).toContain("<p>First sentence.</p>");
  });

  it("lists every built guide on guides.html, and only those", async () => {
    await newGuide({ title: "A brand new guide", summary: "First sentence. Second sentence." });
    await newGuide({ slug: "not-ready", title: "Unfinished", summary: "" });
    const result = await build();
    const page = await built("guides.html");
    expect(result.counts.guides).toBe(7);
    expect(page.match(/<a class="feat feat-link"/g)).toHaveLength(7);
    expect(page).toContain(`<span class="feat-note">Evaporation</span><h3 class="h3">A brand new guide</h3><p>First sentence.</p>`);
    expect(page).toContain(`"url": "https://liveaccess.ai/guide-new-guide.html"`);
    expect(page).not.toContain("not-ready");
  });

  it("shows a live guide's draft title and summary on its card", async () => {
    await db.update(articles).set({ title: "Draft title", summary: "Draft summary. More." }).where(eq(articles.slug, "evaporator-fouling"));
    await build();
    expect(await built("guides.html")).toContain(`<h3 class="h3">Draft title</h3><p>Draft summary.</p>`);
  });

  it("lists a new area on process-areas.html", async () => {
    const [a] = await db.select().from(articles).where(eq(articles.slug, "evaporation"));
    const { id: _id, published: _p, publishedSlug: _s, ...copy } = a!;
    await db.insert(articles).values({ ...copy, slug: "new-area", title: "New area", summary: "New area text. More.", status: "draft" });
    const result = await build();
    expect(result.counts.areas).toBe(9);
    expect(await built("process-areas.html")).toContain(`href="area-new-area.html"><span class="feat-note">Process area</span><h3 class="h3">New area</h3><p>New area text.</p>`);
  });

  it("gives every problem with a draft, not just the first few", async () => {
    await newGuide({ title: "Unfinished", summary: "", blocks: [{ type: "paragraph", html: "" }, { type: "paragraph", html: "" }, { type: "paragraph", html: "" }, { type: "paragraph", html: "" }] });
    const { skipped } = await build();
    expect(skipped[0]!.reason.split(/(?<=\.) /).length).toBeGreaterThan(3);
  });

  it("keeps the live copy of a live guide whose draft is broken, and says so", async () => {
    await db.update(articles).set({ summary: "", title: "Broken draft" }).where(eq(articles.slug, "evaporator-fouling"));
    const result = await build();
    expect(await built("guide-evaporator-fouling.html")).toBe(await source("guide-evaporator-fouling.html"));
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ kind: "guide", title: "Broken draft", live: true });
  });

  it("leaves out a live guide when its live copy can't be trusted either", async () => {
    const [row] = await db.select().from(articles).where(eq(articles.slug, "evaporator-fouling"));
    const tampered = { ...(row!.published as object), publishedDate: `2024-01-01"</script><script>alert(1)</script>` };
    await db.update(articles).set({ summary: "", published: tampered }).where(eq(articles.id, row!.id));
    const result = await build();
    expect(existsSync(out("guide-evaporator-fouling.html"))).toBe(false);
    expect(result.skipped[0]).toMatchObject({ kind: "guide", live: false });
  });

  it("applies draft menus to every page, including pages outside the database", async () => {
    const m: Menus = await liveMenus();
    m.header.links[0]!.label = "Draft link";
    await db.insert(menus).values({ location: "site", items: m });
    await build();
    for (const f of await htmlFiles()) expect(await built(f), f).toContain(">Draft link</a>");
  });

  it("warns about menu links and redirects that point at a page left out of the build", async () => {
    await newGuide({ title: "Unfinished", summary: "" });
    const m = await liveMenus();
    m.header.links.push({ label: "Unfinished", href: "guide-new-guide.html" });
    await db.insert(menus).values({ location: "site", items: m });
    await db.insert(redirects).values({ fromPath: "/old.html", toPath: "guide-new-guide.html" });
    const { warnings } = await build();
    expect(warnings.some((w) => w.includes("Menu") && w.includes("guide-new-guide.html"))).toBe(true);
    expect(warnings.some((w) => w.includes("/old.html") && w.includes("guide-new-guide.html"))).toBe(true);
  });

  it("writes draft settings, robots, llms and redirects", async () => {
    await db.insert(settings).values([
      { key: "site.settings", value: stored({ ...liveSettings, ga4: "G-DRAFT1234", email: "help@tps.ltd" }) },
      { key: "seo.robots", value: stored("User-agent: *\nAllow: /draft\n") },
      { key: "seo.llms", value: stored("# Draft llms\n") }
    ]);
    await db.insert(redirects).values({ fromPath: "/old.html", toPath: "about.html" });
    await build();
    expect(await built("index.html")).toContain("G-DRAFT1234");
    expect(await built("privacy-policy.html")).toContain("mailto:help@tps.ltd");
    expect(await built("consent.js")).toContain("var GA_ID = 'G-DRAFT1234';");
    expect(await built("robots.txt")).toContain("Allow: /draft");
    expect(await built("llms.txt")).toBe("# Draft llms\n");
    expect(await built(".htaccess")).toContain("Redirect 301 /old.html /about.html\n");
  });

  it("warns that a Tag Manager ID isn't applied yet", async () => {
    await db.insert(settings).values({ key: "site.settings", value: stored({ ...liveSettings, gtm: "GTM-ABC1234" }) });
    const { warnings } = await build();
    expect(warnings.join(" ")).toContain("Tag Manager");
    expect(await built("index.html")).not.toContain("GTM-ABC1234");
  });

  it("keeps the last good preview when a build fails", async () => {
    await build();
    const missing = join(previewRoot, "no-such-site");
    await expect(buildSite(db, { siteRoot: missing, previewRoot })).rejects.toThrow();
    expect(await built("index.html")).toBe(await source("index.html"));
    expect(existsSync(join(previewRoot, ".site-preview.tmp"))).toBe(false);
  });

  it("replaces the last preview and leaves no working folders behind", async () => {
    await build();
    await db.update(pages).set({ seoTitle: "Second build" }).where(eq(pages.key, "about"));
    await build();
    expect(await built("about.html")).toContain("<title>Second build</title>");
    expect(await readdir(previewRoot)).toEqual([".site-preview"]);
  });

  it("refuses to build over the site itself", async () => {
    const site = join(previewRoot, ".site-preview");
    await mkdir(site);
    await writeFile(join(site, "index.html"), "real site");
    await expect(buildSite(db, { siteRoot: site, previewRoot })).rejects.toThrow(/site/i);
    await expect(buildSite(db, { siteRoot: site.toUpperCase(), previewRoot })).rejects.toThrow(/site/i);
    expect(await readFile(join(site, "index.html"), "utf8")).toBe("real site");
  });
});

describe("preview server", () => {
  const get = (path: string, init?: RequestInit) => previewSite(join(previewRoot, ".site-preview")).request(`http://localhost:4000${path}`, init);

  beforeEach(async () => {
    await db.insert(redirects).values([{ fromPath: "/old.html", toPath: "about.html" }, { fromPath: "/gone", toPath: "https://tps.ltd/", code: 302 }, { fromPath: "/live", toPath: "https://liveaccess.ai/faq.html" }]);
    await build();
  });

  it("serves the home page and other pages", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe(await built("index.html"));
    expect((await get("/about.html")).status).toBe(200);
    expect((await get("/common.css")).headers.get("content-type")).toContain("text/css");
    expect((await get("/images/" + (await readdir(out("images")))[0])).status).toBe(200);
  });

  it("blocks analytics and form posts, and asks not to be indexed", async () => {
    const res = await get("/contact.html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'(;|$)/);
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects like .htaccess: extensionless pages, /index.html, CMS redirects", async () => {
    const at = async (p: string) => { const r = await get(p); return [r.status, r.headers.get("location")]; };
    expect(await at("/about")).toEqual([301, "/about.html"]);
    expect(await at("/about/")).toEqual([301, "/about.html"]);
    expect(await at("/index.html")).toEqual([301, "/"]);
    expect(await at("/old.html")).toEqual([301, "/about.html"]);
    expect(await at("/gone")).toEqual([302, "https://tps.ltd/"]);
    expect(await at("/live")).toEqual([301, "/faq.html"]);
  });

  it("shows the site's 404 page with a real 404 status", async () => {
    const res = await get("/nothing-here.html");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await built("404.html"));
  });

  it("never serves hidden files or anything outside the folder", async () => {
    await writeFile(join(previewRoot, "secret.txt"), "secret");
    for (const p of ["/.htaccess", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/images/../../secret.txt", "/..%5csecret.txt", "/%00", "/%zz"]) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).not.toContain("secret");
    }
  });

  it("answers only reads, and only for localhost", async () => {
    expect((await get("/", { method: "POST" })).status).toBe(405);
    expect((await previewSite(join(previewRoot, ".site-preview")).request("http://evil.example/")).status).toBe(403);
  });

  it("builds the contact page with its form pointing at the CMS", async () => {
    const html = await built("contact.html");
    expect(html).toContain(`action="/${env.adminPath}/api/contact"`);
    expect(html).toContain(`id="cf-elapsed"`);
    expect(html).not.toContain("formspree");
  });

  it("passes only the contact form's POST to the API", async () => {
    const seen: string[] = [];
    const site = previewSite(join(previewRoot, ".site-preview"), { adminPath: "la-studio", send: (req) => { seen.push(`${req.method} ${new URL(req.url).pathname}`); return new Response("ok"); } });
    const post = (p: string, host = "http://localhost:4000") => site.request(`${host}${p}`, { method: "POST", body: "x" });
    expect(await (await post("/la-studio/api/contact")).text()).toBe("ok");
    expect(seen).toEqual(["POST /la-studio/api/contact"]);
    for (const p of ["/la-studio/api/auth/login", "/la-studio/api/messages", "/la-studio/api/contact/x", "/"]) expect((await post(p)).status, p).toBe(405);
    expect((await post("/la-studio/api/contact", "http://evil.example")).status).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it("says what to do before the first build", async () => {
    const res = await previewSite(join(previewRoot, "nothing")).request("http://localhost:4000/");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Build preview");
  });
});

describe("publish API", () => {
  const api = "http://local/la-studio/api";
  const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, preview: { siteRoot: env.siteRoot, previewRoot, url: "http://localhost:4000/" } });
  let shared: ReturnType<typeof app>;

  async function signIn(a = app()) {
    const { password } = await makeUser(db, { email: "editor@example.com", role: "editor" });
    const res = await a.request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "editor@example.com", password }) });
    const authorization = `Bearer ${(await res.json()).accessToken}`;
    return {
      get: () => a.request(`${api}/publish/preview`, { headers: { authorization } }),
      post: () => a.request(`${api}/publish/preview`, { method: "POST", headers: { authorization } })
    };
  }

  beforeEach(() => { shared = app(); });

  it("needs a signed-in user", async () => {
    expect((await shared.request(`${api}/publish/preview`)).status).toBe(401);
    expect((await shared.request(`${api}/publish/preview`, { method: "POST" })).status).toBe(401);
    expect(existsSync(out("index.html"))).toBe(false);
  });

  it("builds, remembers the result and logs who did it", async () => {
    const { get, post } = await signIn(shared);
    expect(await (await get()).json()).toEqual({ running: false, last: null, url: "http://localhost:4000/" });
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.pages).toBe(12);
    expect((await (await get()).json()).last.builtAt).toBe(body.builtAt);
    expect(existsSync(out("index.html"))).toBe(true);
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "preview_built"));
    expect(log).toHaveLength(1);
  });

  it("runs one build at a time", async () => {
    const { post } = await signIn(shared);
    const statuses = (await Promise.all([post(), post()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("isn't there when the API runs without the preview (production)", async () => {
    const res = await createApp({ db, adminPath: "la-studio", secureCookies: true }).request(`${api}/publish/preview`);
    expect(res.status).toBe(404);
  });
});
