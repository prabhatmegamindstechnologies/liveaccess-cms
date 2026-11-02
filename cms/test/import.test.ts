import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { env } from "../env.ts";
import { importSite } from "../import/site.ts";
import { articles, pages, revisions } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { testDb, wipe } from "./helpers.ts";

let db: Db;
let close: () => Promise<void>;
let summary: Awaited<ReturnType<typeof importSite>>;

beforeAll(async () => {
  ({ db, close } = await testDb());
  await wipe(db);
  summary = await importSite(db, env.siteRoot);
});
afterAll(async () => close());

describe("importSite", () => {
  it("imports 12 pages, 6 guides and 8 process areas", async () => {
    expect(summary).toEqual({ pages: 12, guides: 6, areas: 8 });
    expect(await db.select().from(pages)).toHaveLength(12);
    expect((await db.select().from(articles).where(eq(articles.type, "guide")))).toHaveLength(6);
    expect((await db.select().from(articles).where(eq(articles.type, "area")))).toHaveLength(8);
  });

  it("stores each page's HTML exactly as the file on disk", async () => {
    for (const key of ["about", "home", "privacy"]) {
      const [p] = await db.select().from(pages).where(eq(pages.key, key));
      expect(p!.html).toBe(readFileSync(join(env.siteRoot, p!.file), "utf8"));
      expect(p!.publishedHtml).toBe(p!.html);
      expect(p!.status).toBe("published");
    }
  });

  it("keeps the GA4 tag on every imported page", async () => {
    for (const p of await db.select().from(pages)) expect(p.html, p.key).toContain("G-JFHJD3T51M");
  });

  it("reads SEO fields from the page head", async () => {
    const [p] = await db.select().from(pages).where(eq(pages.key, "about"));
    expect(p!.seoTitle).toBe("About LiveAccess — Built by TPS");
    expect(p!.seoDescription).toMatch(/^LiveAccess is made by TPS/);
    expect(p!.canonical).toBe("https://liveaccess.ai/about.html");
  });

  it("turns the Evaporator fouling guide into 12 blocks with the safety note first", async () => {
    const [g] = await db.select().from(articles).where(eq(articles.slug, "evaporator-fouling"));
    const blocks = g!.blocks as { type: string; variant?: string }[];
    expect(blocks).toHaveLength(12);
    expect(blocks[0]).toMatchObject({ type: "callout", variant: "safety" });
    expect(g!).toMatchObject({ type: "guide", title: "Evaporator fouling and falling capacity: causes and checks", areaSlug: "evaporation", publishedDate: "2026-10-29", status: "published" });
    expect(g!.summary).toMatch(/^When an evaporator gives lower concentrate solids/);
  });

  it("imports process areas with their title and summary", async () => {
    const [a] = await db.select().from(articles).where(eq(articles.slug, "evaporation"));
    expect(a!).toMatchObject({ type: "area", title: "Evaporation", areaSlug: null });
    expect((a!.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("can run again without creating duplicates", async () => {
    const again = await importSite(db, env.siteRoot);
    expect(again).toEqual({ pages: 12, guides: 6, areas: 8 });
    expect(await db.select().from(pages)).toHaveLength(12);
    expect(await db.select().from(articles)).toHaveLength(14);
    expect(await db.select().from(revisions)).toHaveLength(52);
  });
});
