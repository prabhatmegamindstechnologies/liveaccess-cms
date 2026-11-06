import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import sharp from "sharp";
import { createApp } from "../api/app.ts";
import { localDriver } from "../api/media/storage.ts";
import { env } from "../env.ts";
import { articles, auditLog, media, pages } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { importSite } from "../import/site.ts";
import { buildSite } from "../publish/build-site.ts";
import { makeUser, testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
let tmp: string;
const api = "http://local/la-studio/api";
const storage = () => localDriver(join(tmp, "store"));
const app = () => createApp({ db, adminPath: "la-studio", secureCookies: true, mediaStorage: storage() });

beforeAll(async () => {
  ({ db, close } = await testDb());
  tmp = await mkdtemp(join(tmpdir(), "la-media-"));
});
afterAll(async () => {
  await close();
  await rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => wipe(db));

const canvas = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#336699" } });
const jpeg = (w = 300, h = 200) => canvas(w, h).jpeg().toBuffer();
const png = (w = 300, h = 200) => canvas(w, h).png().toBuffer();

type Item = { id: number; key: string; src: string; fileName: string; altText: string; width: number; height: number; bytes: number; usedIn: { title: string; link: string; live: boolean }[] };

async function signIn(role: "super_admin" | "editor" = "editor") {
  const { password } = await makeUser(db, { role });
  const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password }) });
  const authorization = `Bearer ${(await res.json()).accessToken}`;
  const send = (path: string, data: Buffer | null, name = "photo.jpg", alt: string | null = "A pump", on = app()) => {
    const form = new FormData();
    if (data) form.set("file", new File([new Uint8Array(data)], name));
    if (alt !== null) form.set("alt", alt);
    return on.request(`${api}${path}`, { method: "POST", headers: { authorization }, body: form });
  };
  const upload = async (data?: Buffer, name?: string, alt?: string) => {
    const r = await send("/media", data ?? await jpeg(), name, alt);
    expect(r.status).toBe(201);
    return (await r.json()).media as Item;
  };
  const get = (path: string) => app().request(`${api}${path}`, { headers: { authorization } });
  const call = (method: string, path: string, data?: unknown) =>
    app().request(`${api}${path}`, { method, headers: { authorization, "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { send, upload, get, call };
}

const stored = (m: { key: string }) => storage().get(m.key);
const fileUrl = (key: string) => `${api}/media/files/${key}`;

describe("POST /media", () => {
  it.each([
    ["JPEG", () => jpeg(), "a.jpg"],
    ["PNG", () => png(), "a.png"],
    ["WebP", () => canvas(300, 200).webp().toBuffer(), "a.webp"]
  ])("saves a %s as WebP under a random name", async (_, make, name) => {
    const s = await signIn();
    const m = await s.upload(await make(), name);
    expect(m).toMatchObject({ fileName: name, altText: "A pump", width: 300, height: 200 });
    expect(m.key).toMatch(/^[a-f0-9]{32}\.webp$/);
    expect(m.src).toBe(`images/cms/${m.key}`);
    const file = await stored(m);
    expect((await sharp(file!).metadata()).format).toBe("webp");
    expect(m.bytes).toBe(file!.length);
  });

  it("removes hidden data from the photo", async () => {
    const s = await signIn();
    const data = await canvas(300, 200).withExif({ IFD0: { Copyright: "secret-owner" } }).jpeg().toBuffer();
    expect(data.includes("secret-owner")).toBe(true);
    const file = await stored(await s.upload(data));
    expect(file!.includes("secret-owner")).toBe(false);
    expect((await sharp(file!).metadata()).exif).toBeUndefined();
  });

  it("applies the photo's rotation", async () => {
    const s = await signIn();
    const data = await canvas(300, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(await s.upload(data)).toMatchObject({ width: 200, height: 300 });
  });

  it("shrinks very wide images and never enlarges small ones", async () => {
    const s = await signIn();
    expect(await s.upload(await jpeg(3000, 1500))).toMatchObject({ width: 2400, height: 1200 });
    expect(await s.upload(await jpeg(40, 30))).toMatchObject({ width: 40, height: 30 });
  });

  it("keeps transparency", async () => {
    const s = await signIn();
    const data = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect((await sharp((await stored(await s.upload(data)))!).metadata()).hasAlpha).toBe(true);
  });

  it("goes by the real format, not the file name", async () => {
    const s = await signIn();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const gif = await canvas(20, 20).gif().toBuffer();
    for (const [data, name] of [[Buffer.from("not an image"), "a.jpg"], [svg, "a.png"], [gif, "a.jpg"], [Buffer.alloc(0), "a.jpg"]] as const) {
      const res = await s.send("/media", data, name);
      expect(res.status, name).toBe(422);
    }
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it("refuses more than 10 MB, and more than 50 megapixels", async () => {
    const s = await signIn();
    expect((await s.send("/media", Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await s.send("/media", Buffer.alloc(12 * 1024 * 1024))).status).toBe(413);
    expect((await s.send("/media", await canvas(8000, 7000).png().toBuffer())).status).toBe(422);
  });

  it("needs a file and alt text", async () => {
    const s = await signIn();
    const data = await jpeg();
    for (const [file, alt] of [[null, "A pump"], [data, null], [data, "   "], [data, "x".repeat(301)], [data, "a\u202Eb"]] as const) {
      expect((await s.send("/media", file, "a.jpg", alt)).status).toBe(422);
    }
  });

  it("cleans the file name", async () => {
    const s = await signIn();
    const m = await s.upload(await jpeg(), "C:\\fakepath\\my\u0007 photo.jpg");
    expect(m.fileName).toBe("my photo.jpg");
  });

  it("needs a token", async () => {
    const res = await app().request(`${api}/media`, { method: "POST" });
    expect(res.status).toBe(401);
    expect((await app().request(`${api}/media`)).status).toBe(401);
  });

  it("limits uploads per person", async () => {
    const s = await signIn();
    const shared = app();
    const data = await jpeg(10, 10);
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await s.send("/media", data, "a.jpg", "A pump", shared)).status);
    expect(statuses.at(-2)).toBe(201);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("GET /media/files/:key", () => {
  it("is public, with headers that stop the file acting as anything but an image", async () => {
    const s = await signIn();
    const m = await s.upload();
    const res = await app().request(fileUrl(m.key));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(Buffer.from(await res.arrayBuffer()).equals((await stored(m))!)).toBe(true);
  });

  it("can be cached for good when the address has a version", async () => {
    const s = await signIn();
    const m = await s.upload();
    expect((await app().request(`${fileUrl(m.key)}?v=123`)).headers.get("cache-control")).toMatch(/immutable/);
  });

  it("finds nothing else", async () => {
    const s = await signIn();
    await s.upload();
    for (const key of ["abc.webp", "..%2f..%2fpackage.json", "%2e%2e%2f.env", `${"a".repeat(32)}.png`, `${"a".repeat(32)}.webp`, `${"A".repeat(32)}.webp`]) {
      expect((await app().request(fileUrl(key))).status, key).toBe(404);
    }
  });
});

describe("GET /media", () => {
  it("lists newest first, with no storage details", async () => {
    const s = await signIn();
    const a = await s.upload(await jpeg(), "first.jpg");
    const b = await s.upload(await jpeg(), "second.jpg");
    const body = await (await s.get("/media")).json();
    expect(body.items.map((i: Item) => i.id)).toEqual([b.id, a.id]);
    expect(body.total).toBe(2);
    expect(body.items[0].usedIn).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(tmp.replace(/\\/g, "\\\\"));
  });

  it("searches names and alt text, taking wildcards literally", async () => {
    const s = await signIn();
    await s.upload(await jpeg(), "pump.jpg", "A centrifugal unit");
    await s.upload(await jpeg(), "valve.jpg", "100% stainless");
    const names = async (q: string) => (await (await s.get(`/media?q=${encodeURIComponent(q)}`)).json()).items.map((i: Item) => i.fileName);
    expect(await names("PUMP")).toEqual(["pump.jpg"]);
    expect(await names("centrifugal")).toEqual(["pump.jpg"]);
    expect(await names("%")).toEqual(["valve.jpg"]);
    expect(await names("_")).toEqual([]);
  });

  it("pages through the library", async () => {
    const s = await signIn();
    await db.insert(media).values(Array.from({ length: 50 }, (_, i) => ({ fileName: `${i}.webp`, storageKey: `${String(i).padStart(32, "0")}.webp`, mime: "image/webp", bytes: 1 })));
    const first = await (await s.get("/media")).json(), second = await (await s.get("/media?page=2")).json();
    expect(first).toMatchObject({ total: 50, pageSize: 48 });
    expect(first.items).toHaveLength(48);
    expect(second.items).toHaveLength(2);
    expect((await s.get("/media?page=abc")).status).toBe(400);
  });
});

describe("PATCH /media/:id", () => {
  it("changes the alt text", async () => {
    const s = await signIn();
    const m = await s.upload();
    const res = await s.call("PATCH", `/media/${m.id}`, { altText: "  Worn seal " });
    expect(res.status).toBe(200);
    expect((await res.json()).media.altText).toBe("Worn seal");
  });

  it("refuses empty alt text and unknown images", async () => {
    const s = await signIn();
    const m = await s.upload();
    expect((await s.call("PATCH", `/media/${m.id}`, { altText: " " })).status).toBe(422);
    expect((await s.call("PATCH", "/media/99999", { altText: "x" })).status).toBe(404);
    expect((await s.call("PATCH", "/media/abc", { altText: "x" })).status).toBe(404);
  });
});

describe("POST /media/:id/replace", () => {
  it("swaps the file and keeps the id, the address and the alt text", async () => {
    const s = await signIn();
    const m = await s.upload(await jpeg(300, 200), "old.jpg");
    const before = await stored(m);
    const res = await s.send(`/media/${m.id}/replace`, await png(120, 90), "new.png", null);
    expect(res.status).toBe(200);
    const next = (await res.json()).media as Item;
    expect(next).toMatchObject({ id: m.id, key: m.key, fileName: "new.png", altText: "A pump", width: 120, height: 90 });
    expect((await stored(m))!.equals(before!)).toBe(false);
  });

  it("leaves the image as it was when the new file is refused", async () => {
    const s = await signIn();
    const m = await s.upload();
    const before = await stored(m);
    expect((await s.send(`/media/${m.id}/replace`, Buffer.from("nope"), "a.jpg", null)).status).toBe(422);
    expect((await stored(m))!.equals(before!)).toBe(true);
    expect((await s.send("/media/99999/replace", await jpeg(), "a.jpg", null)).status).toBe(404);
  });
});

describe("usage and DELETE /media/:id", () => {
  const firstGuide = async () => (await db.select().from(articles).where(eq(articles.type, "guide")).orderBy(articles.id))[0]!;
  const firstPage = async () => (await db.select().from(pages).orderBy(pages.id))[0]!;
  const refused = async (s: Awaited<ReturnType<typeof signIn>>, m: Item, title: string) => {
    const res = await s.call("DELETE", `/media/${m.id}`);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain(title);
    expect(await stored(m)).not.toBeNull();
    expect(await db.select().from(media)).toHaveLength(1);
  };

  it("removes an unused image and its file", async () => {
    const s = await signIn();
    const m = await s.upload();
    expect((await s.call("DELETE", `/media/${m.id}`)).status).toBe(204);
    expect(await db.select().from(media)).toHaveLength(0);
    expect(await stored(m)).toBeNull();
    expect((await app().request(fileUrl(m.key))).status).toBe(404);
    expect((await s.call("DELETE", `/media/${m.id}`)).status).toBe(404);
  });

  it("refuses while a draft page uses it", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const p = await firstPage();
    await db.update(pages).set({ html: `${p.html}<img src="${m.src}">` }).where(eq(pages.id, p.id));
    await refused(s, m, p.title);
    const [listed] = (await (await s.get("/media")).json()).items;
    expect(listed.usedIn).toEqual([{ kind: "page", title: p.title, link: `/pages/${p.key}`, live: false }]);
  });

  it("refuses while the live copy of a page still uses it", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const p = await firstPage();
    await db.update(pages).set({ publishedHtml: `${p.html}<img src="${m.src}">` }).where(eq(pages.id, p.id));
    await refused(s, m, p.title);
    expect((await (await s.get("/media")).json()).items[0].usedIn[0].live).toBe(true);
  });

  it("refuses while an image block or a paragraph uses it", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const g = await firstGuide();
    await db.update(articles).set({ blocks: [{ type: "image", mediaId: m.id, position: "center", alt: "a", caption: "" }] }).where(eq(articles.id, g.id));
    await refused(s, m, g.title);
    await db.update(articles).set({ blocks: [{ type: "paragraph", html: `<p><img src="${m.src}" alt="a"></p>` }] }).where(eq(articles.id, g.id));
    await refused(s, m, g.title);
  });

  it("refuses while only the live copy of a guide uses it", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const g = await firstGuide();
    await db.update(articles).set({ published: { slug: g.slug, blocks: [{ type: "image", mediaId: m.id, position: "center", alt: "a", caption: "" }] } }).where(eq(articles.id, g.id));
    await refused(s, m, g.title);
  });

  it("isn't fooled by another image's number in a guide", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const g = await firstGuide();
    await db.update(articles).set({ blocks: [{ type: "heading", level: 2, text: `mediaId ${m.id}` }] }).where(eq(articles.id, g.id));
    expect((await s.call("DELETE", `/media/${m.id}`)).status).toBe(204);
  });
});

describe("audit", () => {
  it("logs each change by name, without file paths", async () => {
    const s = await signIn();
    const m = await s.upload(await jpeg(), "pump.jpg");
    await s.call("PATCH", `/media/${m.id}`, { altText: "New" });
    await s.send(`/media/${m.id}/replace`, await jpeg(), "pump2.jpg", null);
    await s.call("DELETE", `/media/${m.id}`);
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityType, "media")).orderBy(auditLog.id);
    expect(rows.map((r) => r.action)).toEqual(["media_uploaded", "media_edited", "media_replaced", "media_deleted"]);
    expect(rows[0]!.detail).toEqual({ title: "pump.jpg" });
    expect(JSON.stringify(rows)).not.toContain("store");
  });

  it("shows under Content in the audit log, and not on the Dashboard", async () => {
    const { password } = await makeUser(db, { email: "boss@example.com", role: "super_admin" });
    const res = await app().request(`${api}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "boss@example.com", password }) });
    const authorization = `Bearer ${(await res.json()).accessToken}`;
    const s = await signIn();
    await s.upload(await jpeg(), "pump.jpg");
    const log = await (await app().request(`${api}/audit?group=content`, { headers: { authorization } })).json();
    expect(log.entries.map((e: { action: string }) => e.action)).toContain("media_uploaded");
    expect(log.entries[0].item).toEqual({ title: "pump.jpg", link: null });
    const dash = await (await s.get("/dashboard")).json();
    expect(dash.activity).toEqual([]);
  });
});

describe("using library images", () => {
  it("gives the guide and area editors the files their blocks need", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const [g] = await db.select().from(articles).where(eq(articles.type, "guide")).orderBy(articles.id);
    await db.update(articles).set({ blocks: [{ type: "image", mediaId: m.id, position: "center", alt: "a", caption: "" }, { type: "image", mediaId: null, position: "center", alt: "", caption: "" }] }).where(eq(articles.id, g!.id));
    const body = await (await s.get(`/guides/${g!.id}`)).json();
    expect(body.mediaFiles).toEqual({ [m.id]: m.key });
  });

  it("saves an image block in a guide", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const [g] = await db.select().from(articles).where(eq(articles.type, "guide")).orderBy(articles.id);
    const { guide } = await (await s.get(`/guides/${g!.id}`)).json();
    const blocks = [...guide.blocks, { type: "image", mediaId: m.id, position: "left", alt: "A pump", caption: "" }];
    const res = await s.call("PUT", `/guides/${g!.id}`, { ...guide, baseVersion: guide.version, blocks });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(articles).where(eq(articles.id, g!.id));
    expect((row!.blocks as unknown[]).at(-1)).toEqual({ type: "image", mediaId: m.id, position: "left", alt: "A pump", caption: "" });
  });

  it("lets a page swap an image for a library one, and still refuses a data: address", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    const [p] = await db.select().from(pages).where(like(pages.html, '%<img%src="images/%')).orderBy(pages.id);
    const swap = (src: string) => p!.html.replace(/(<img\b[^>]*?\ssrc=")images\/[^"]+/, `$1${src}`);
    expect(swap(m.src)).not.toBe(p!.html);
    expect((await s.call("PUT", `/pages/${p!.key}`, { baseVersion: p!.version, html: swap("data:image/png;base64,AAAA") })).status).toBe(422);
    expect((await s.call("PUT", `/pages/${p!.key}`, { baseVersion: p!.version, html: swap(m.src) })).status).toBe(200);
  });
});

describe("Publish", () => {
  const build = async () => {
    const previewRoot = await mkdtemp(join(tmp, "site-"));
    const result = await buildSite(db, { siteRoot: env.siteRoot, previewRoot, storage: storage() });
    return { result, out: join(previewRoot, ".site-preview") };
  };
  const useInGuide = async (id: number) => {
    const [g] = await db.select().from(articles).where(eq(articles.type, "guide")).orderBy(articles.id);
    await db.update(articles).set({ blocks: sql`${articles.blocks} || ${JSON.stringify([{ type: "image", mediaId: id, position: "center", alt: "A pump", caption: "" }])}::jsonb` }).where(eq(articles.id, g!.id));
    return g!;
  };

  it("copies the files in use, and only those", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const inBlock = await s.upload(), inPage = await s.upload(), unused = await s.upload();
    const g = await useInGuide(inBlock.id);
    const [p] = await db.select().from(pages).where(like(pages.html, '%<img%src="images/%')).orderBy(pages.id);
    await db.update(pages).set({ html: p!.html.replace(/(<img\b[^>]*?\ssrc=")images\/[^"]+/, `$1${inPage.src}`) }).where(eq(pages.id, p!.id));

    const { out, result } = await build();
    expect((await readdir(join(out, "images/cms"))).sort()).toEqual([inBlock.key, inPage.key].sort());
    expect(await readdir(join(out, "images/cms"))).not.toContain(unused.key);
    expect((await readFile(join(out, "images/cms", inBlock.key))).equals((await stored(inBlock))!)).toBe(true);
    expect(await readFile(join(out, `guide-${g.slug}.html`), "utf8")).toContain(`<figure class="cms-img cms-img-center"><img src="${inBlock.src}" alt="A pump">`);
    expect(await readFile(join(out, p!.file), "utf8")).toContain(inPage.src);
    expect(result.warnings.join(" ")).not.toMatch(/image/i);
    expect(await readdir(join(out, "images"))).toContain("how-step-1.webp");
  });

  it("warns about a file that's gone, or a block whose image is gone", async () => {
    await importSite(db, env.siteRoot);
    const s = await signIn();
    const m = await s.upload();
    await useInGuide(m.id);
    await storage().remove(m.key);
    const missingFile = await build();
    expect(missingFile.result.warnings.join(" ")).toContain(m.fileName);

    await db.delete(media);
    const missingRow = await build();
    expect(missingRow.result.warnings.join(" ")).toMatch(/image that's no longer in the library/);
  });
});
