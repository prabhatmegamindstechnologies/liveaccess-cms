// Imports the current site's HTML files into the CMS database. Reads the files, never changes them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { parseHTML } from "linkedom";
import { importBlocks, normalizeSpace } from "@liveaccess/shared";
import type { Db } from "../db/client.ts";
import { articles, pages, revisions } from "../db/schema.ts";

export const PAGES = [
  { key: "home", file: "index.html", url: "/", title: "Home" },
  { key: "about", file: "about.html", url: "/about.html", title: "About us" },
  { key: "contact", file: "contact.html", url: "/contact.html", title: "Contact us" },
  { key: "features", file: "features.html", url: "/features.html", title: "Features" },
  { key: "how-it-works", file: "how-it-works.html", url: "/how-it-works.html", title: "How it works" },
  { key: "faq", file: "faq.html", url: "/faq.html", title: "FAQ" },
  { key: "privacy", file: "privacy-policy.html", url: "/privacy-policy.html", title: "Privacy policy" },
  { key: "terms", file: "terms-and-condition.html", url: "/terms-and-condition.html", title: "Terms & conditions" },
  { key: "delete-account", file: "delete-account.html", url: "/delete-account.html", title: "Delete account" },
  { key: "get-app", file: "get-app.html", url: "/get-app.html", title: "Get the app" },
  { key: "guides", file: "guides.html", url: "/guides.html", title: "Troubleshooting guides page" },
  { key: "process-areas", file: "process-areas.html", url: "/process-areas.html", title: "Process areas page" }
] as const;

const EXPECTED = { pages: 12, guides: 6, areas: 8 };

function readSeo(document: Document) {
  const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";
  return {
    seoTitle: normalizeSpace(document.querySelector("title")?.textContent ?? ""),
    seoDescription: meta("description"),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
    noindex: /noindex/i.test(meta("robots"))
  };
}

export async function importSite(db: Db, siteRoot: string) {
  const read = (file: string) => readFileSync(join(siteRoot, file), "utf8");
  const files = readdirSync(siteRoot);
  const guideFiles = files.filter((f) => /^guide-[a-z0-9-]+\.html$/.test(f)).sort();
  const areaFiles = files.filter((f) => /^area-[a-z0-9-]+\.html$/.test(f)).sort();
  const count = { pages: PAGES.length, guides: guideFiles.length, areas: areaFiles.length };
  if (JSON.stringify(count) !== JSON.stringify(EXPECTED)) {
    throw new Error(`Unexpected site files: found ${JSON.stringify(count)}, expected ${JSON.stringify(EXPECTED)}.`);
  }

  await db.transaction(async (tx) => {
    for (const p of PAGES) {
      const html = read(p.file);
      const { document } = parseHTML(html);
      const row = { ...p, html, publishedHtml: html, status: "published" as const, publishedAt: new Date(), ...readSeo(document) };
      const [saved] = await tx.insert(pages).values(row)
        .onConflictDoUpdate({ target: pages.key, set: { ...row, updatedAt: sql`now()` } })
        .returning({ id: pages.id });
      await tx.insert(revisions).values({ entityType: "page", entityId: saved!.id, snapshot: { html, ...readSeo(document) }, note: "Imported from the site files" });
    }

    for (const [type, list] of [["guide", guideFiles], ["area", areaFiles]] as const) {
      for (const file of list) {
        const { document } = parseHTML(read(file));
        const article = document.querySelector("article.article");
        if (!article) throw new Error(`${file}: no <article class="article"> found.`);
        const slug = file.replace(/^(guide|area)-/, "").replace(/\.html$/, "");
        const areaHref = type === "guide" ? document.querySelector(".page-hero .byline a")?.getAttribute("href") ?? "" : "";
        const row = {
          type,
          slug,
          publishedSlug: slug,
          title: normalizeSpace(document.querySelector(".page-hero h1")?.textContent ?? slug),
          summary: normalizeSpace(document.querySelector(".page-hero .lede")?.textContent ?? ""),
          areaSlug: areaHref.match(/^area-([a-z0-9-]+)\.html$/)?.[1] ?? null,
          publishedDate: document.querySelector(".page-hero time")?.getAttribute("datetime") ?? null,
          blocks: importBlocks(article),
          status: "published" as const,
          ...readSeo(document)
        };
        // The file is what's live: keep it as the published copy (see articles.published).
        const published = {
          slug, title: row.title, summary: row.summary, areaSlug: row.areaSlug ?? "", publishedDate: row.publishedDate ?? "",
          blocks: row.blocks, seo: { title: row.seoTitle, description: row.seoDescription, noindex: row.noindex }
        };
        const [saved] = await tx.insert(articles).values({ ...row, published })
          .onConflictDoUpdate({ target: [articles.type, articles.slug], set: { ...row, published, updatedAt: sql`now()` } })
          .returning({ id: articles.id });
        await tx.insert(revisions).values({ entityType: "article", entityId: saved!.id, snapshot: row, note: "Imported from the site files" });
      }
    }
  });

  return count;
}
