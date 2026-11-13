// Builds the static site from the local drafts into .site-preview/ so it can be checked before anything goes live.
// Reads the database and the site folder, never changes either. The output is what real Publish will write: anything
// that makes it safe for local viewing lives in the preview server's headers, not in these files.
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { parseHTML } from "linkedom";
import {
  applyConsentJs, applyContactForm, applyListing, applyMenus, applyPageSeo, applySeoDefaults, applySiteSettings, buildSitemap, guideCardsFromPage, MEDIA_DIR, mediaKeysIn, plainText, redirectsHtaccess,
  renderAreaPage, renderGuidePage, validateArea, validateGuide, withoutCmsRedirects,
  type AreaGuide, type Block, type Guide, type ListingItem, type Menus, type SeoDefaults, type SiteSettings
} from "@liveaccess/shared";
import { localDriver, type MediaStorage } from "../api/media/storage.ts";
import type { Db } from "../db/client.ts";
import { articles, media, menus, pages, redirects, settings } from "../db/schema.ts";
import { env } from "../env.ts";

export const PREVIEW_DIR = ".site-preview";
const WORK_DIR = ".site-preview.tmp";
// The same files .github/workflows/deploy.yml uploads.
const SITE_FILES = new Set([".html", ".css", ".js", ".png", ".svg", ".mp4", ".txt", ".xml", ".woff2"]);
const GENERATED = new Set(["robots.txt", "llms.txt", "sitemap.xml"]);

type Kind = "guide" | "area";
type Row = typeof articles.$inferSelect;

/** A draft that isn't in the preview as it stands. `live` = its last published copy was built instead. */
export type Skipped = { kind: "page" | Kind; id: number | string; title: string; reason: string; live: boolean };
export type BuildResult = {
  builtAt: string;
  counts: { pages: number; guides: number; areas: number; files: number };
  skipped: Skipped[];
  warnings: string[];
};

const doc = () => parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const snapshot = (r: Row): Guide => ({
  slug: r.slug, title: r.title, summary: r.summary, areaSlug: r.areaSlug ?? "", publishedDate: r.publishedDate ?? "",
  blocks: r.blocks as Block[], seo: { title: r.seoTitle, description: r.seoDescription, noindex: r.noindex }
});

/** Reads every draft the build needs. Values without a draft row stay undefined: the page's own value is kept. */
async function readDrafts(db: Db) {
  const [pageRows, articleRows, menuRows, settingRows, redirectRows, mediaRows] = await Promise.all([
    db.select().from(pages).orderBy(pages.id),
    db.select().from(articles).orderBy(articles.id),
    db.select().from(menus),
    db.select().from(settings),
    db.select().from(redirects).orderBy(redirects.id),
    db.select({ id: media.id, key: media.storageKey, fileName: media.fileName }).from(media)
  ]);
  const draft = <T>(key: string) => (settingRows.find((s) => s.key === key)?.value as { value?: T } | undefined)?.value;
  return {
    pageRows, articleRows, redirectRows, mediaRows,
    menus: menuRows.find((m) => m.location === "site")?.items as Menus | undefined,
    site: draft<SiteSettings>("site.settings"),
    defaults: draft<SeoDefaults>("seo.defaults"),
    robots: draft<string>("seo.robots"),
    llms: draft<string>("seo.llms")
  };
}

/** Rename can fail for a moment on Windows while the preview server or a virus scanner has a file open. */
async function move(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, attempt * 100));
    }
  }
}

/** Puts the new build in place. The old one is moved aside first and comes back if that fails. */
async function swapIn(work: string, out: string) {
  const old = `${out}.old`;
  await rm(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const hadPreview = await move(out, old).then(() => true, (e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return false;
    throw e;
  });
  try {
    await move(work, out);
  } catch (e) {
    if (hadPreview) await move(old, out);
    throw e;
  }
  await rm(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** The drafts this build used as they are, so Publish can mark exactly those as live. */
export type BuiltDrafts = { pages: { id: number; html: string }[]; articles: { id: number; value: Guide }[] };

async function build(db: Db, root: string, work: string, storage: MediaStorage): Promise<{ result: BuildResult; drafts: BuiltDrafts }> {
  const fromDrafts: BuiltDrafts = { pages: [], articles: [] };
  const draftIds = new Set<number>();
  const d = await readDrafts(db);
  const skipped: Skipped[] = [];
  const warnings: string[] = [];
  const written = new Set<string>();
  const counts = { pages: 0, guides: 0, areas: 0, files: 0 };
  const usedMedia = new Set<string>();
  const mediaById = new Map(d.mediaRows.map((m) => [m.id, m]));
  const mediaSrc = (id: number) => {
    const m = mediaById.get(id);
    if (!m) warnings.push(`A guide or area has an image that's no longer in the library (number ${id}), so it's left out.`);
    return m ? `${MEDIA_DIR}${m.key}` : null;
  };

  const names = await readdir(root);
  const write = async (file: string, content: string) => {
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(file)) throw new Error(`Refused to write ${JSON.stringify(file)}.`);
    await writeFile(join(work, file), content);
    written.add(file);
    for (const key of mediaKeysIn(content)) usedMedia.add(key);
  };

  // The live address is only known from the pages themselves (the home page has no mailto link).
  const liveEmail = d.pageRows.map((p) => /href="mailto:([^"?]+)/.exec(p.publishedHtml ?? p.html)?.[1]).find(Boolean) ?? "";
  /** What every page gets, whatever it came from. */
  const finish = (html: string, file: string) => {
    let out = d.menus ? applyMenus(html, d.menus, file) : html;
    if (d.site) out = applySiteSettings(out, d.site, { email: liveEmail });
    if (file === "contact.html") {
      // The form sends to the CMS inbox. If the form has changed shape, the page is still built, with its form as it was.
      try {
        out = applyContactForm(out, env.adminPath);
      } catch (e) {
        warnings.push(`contact.html still sends to its old form address: ${message(e)}`);
      }
    }
    return d.defaults ? applySeoDefaults(out, d.defaults) : out;
  };

  /* Pages */
  for (const p of d.pageRows) {
    try {
      const html = applyPageSeo(p.html, { title: p.seoTitle, description: p.seoDescription, canonical: p.canonical, noindex: p.noindex });
      await write(p.file, finish(html, p.file));
      fromDrafts.pages.push({ id: p.id, html });
    } catch (e) {
      skipped.push({ kind: "page", id: p.key, title: p.title, reason: message(e), live: p.publishedHtml != null });
      if (p.publishedHtml == null) continue;
      await write(p.file, p.publishedHtml);
    }
    counts.pages++;
  }

  /* Guides and process areas: the draft when it's complete, otherwise the live copy, otherwise left out. */
  const reasons = (errors: Record<string, string>) => Object.values(errors).join(" ");
  const pick = (r: Row, kind: Kind, check: (g: Guide) => { ok: true; value: Guide } | { ok: false; errors: Record<string, string> }) => {
    const res = check(snapshot(r));
    if (res.ok) {
      draftIds.add(r.id);
      return res.value;
    }
    // The live copy gets the same check: it goes into the same scripts and links.
    const live = r.published ? check(r.published as Guide) : null;
    skipped.push({ kind, id: r.id, title: r.title, reason: reasons(res.errors), live: !!live?.ok });
    return live?.ok ? live.value : null;
  };
  const template = async (kind: Kind, r: Row) => {
    const re = new RegExp(`^${kind}-[a-z0-9-]+\\.html$`);
    const list = names.filter((n) => re.test(n)).sort();
    const own = `${kind}-${(r.published as Guide | null)?.slug ?? r.slug}.html`;
    const name = list.includes(own) ? own : list[0];
    if (!name) throw new Error(`The site folder has no ${kind} page to use as a template.`);
    return readFile(join(root, name), "utf8");
  };

  const areas: { row: Row; area: Guide }[] = [];
  for (const row of d.articleRows.filter((r) => r.type === "area")) {
    const area = pick(row, "area", (g) => {
      const c = validateArea(g, doc());
      return c.ok ? { ok: true, value: { ...g, ...c.area } } : c;
    });
    if (area) areas.push({ row, area });
  }
  const areaNames = new Map(areas.map((a) => [a.area.slug, a.area.title]));

  const guides: { row: Row; guide: Guide }[] = [];
  for (const row of d.articleRows.filter((r) => r.type === "guide")) {
    const guide = pick(row, "guide", (g) => {
      const c = validateGuide(g, new Set(areaNames.keys()), doc());
      return c.ok ? { ok: true, value: c.guide } : c;
    });
    if (!guide) continue;
    const file = `guide-${guide.slug}.html`;
    try {
      await write(file, finish(renderGuidePage(await template("guide", row), guide, areaNames.get(guide.areaSlug) ?? "", doc(), mediaSrc), file));
      guides.push({ row, guide });
      if (draftIds.has(row.id)) fromDrafts.articles.push({ id: row.id, value: guide });
      counts.guides++;
    } catch (e) {
      skipped.push({ kind: "guide", id: row.id, title: row.title, reason: message(e), live: false });
    }
  }

  for (const { row, area } of areas) {
    const file = `area-${area.slug}.html`;
    try {
      const page = await template("area", row);
      // Cards keep the order of the live page (it's hand-made); new guides go at the end.
      const order = guideCardsFromPage(page).map((c) => c.slug);
      const rank = (slug: string) => (order.includes(slug) ? order.indexOf(slug) : order.length);
      const cards: AreaGuide[] = guides.filter((g) => g.guide.areaSlug === area.slug).map((g) => g.guide).sort((a, b) => rank(a.slug) - rank(b.slug));
      await write(file, finish(renderAreaPage(page, area, cards, doc(), mediaSrc), file));
      if (draftIds.has(row.id)) fromDrafts.articles.push({ id: row.id, value: area });
      counts.areas++;
    } catch (e) {
      skipped.push({ kind: "area", id: row.id, title: row.title, reason: message(e), live: false });
    }
  }

  /* Listing pages: they're stored pages, so they only learn here what was really built. */
  // An area's summary is its intro line (text-editor HTML); its card shows the plain words.
  const listing = (r: Row, g: Guide, note: string, kind: Kind = "guide"): ListingItem => {
    const words = (s: string | undefined) => (s === undefined || kind === "guide" ? s : plainText(s, doc()));
    const summary = words(g.summary)!;
    return { slug: g.slug, title: g.title, note, summary, summaryChanged: words((r.published as Guide | null)?.summary) !== summary };
  };
  const relist = async (file: string, kind: Kind, items: ListingItem[]) => {
    if (!written.has(file)) return;
    try {
      await write(file, applyListing(await readFile(join(work, file), "utf8"), kind, items));
    } catch (e) {
      warnings.push(`${file} doesn't show the latest list: ${message(e)}`);
    }
  };
  await relist("guides.html", "guide", guides.map((g) => listing(g.row, g.guide, areaNames.get(g.guide.areaSlug) ?? "")));
  await relist("process-areas.html", "area", areas.filter((a) => written.has(`area-${a.area.slug}.html`)).map((a) => listing(a.row, a.area, "Process area", "area")));

  /* Site files */
  const entries = [
    ...d.pageRows.filter((p) => !p.noindex && written.has(p.file)).map((p) => ({ path: p.url.replace(/^\//, ""), lastmod: p.publishedAt ?? p.updatedAt })),
    ...guides.filter((g) => !g.guide.seo.noindex).map((g) => ({ path: `guide-${g.guide.slug}.html`, lastmod: g.guide.publishedDate || g.row.updatedAt })),
    ...areas.filter((a) => !a.area.seo.noindex && written.has(`area-${a.area.slug}.html`)).map((a) => ({ path: `area-${a.area.slug}.html`, lastmod: a.area.publishedDate || a.row.updatedAt }))
  ];
  await write("sitemap.xml", buildSitemap(entries));
  await write("robots.txt", d.robots ?? await readFile(join(root, "robots.txt"), "utf8"));
  await write("llms.txt", d.llms ?? await readFile(join(root, "llms.txt"), "utf8"));
  await writeFile(join(work, ".htaccess"), withoutCmsRedirects(await readFile(join(root, ".htaccess"), "utf8")) + redirectsHtaccess(d.redirectRows.map((r) => ({ from: r.fromPath, to: r.toPath, code: r.code as 301 | 302 }))));
  await cp(join(root, "images"), join(work, "images"), { recursive: true });

  for (const name of names) {
    if (!SITE_FILES.has(extname(name)) || written.has(name) || GENERATED.has(name)) continue;
    // A guide or area page in the folder that isn't in the database isn't part of the site any more.
    if (/^(guide|area)-.*\.html$/.test(name)) continue;
    if (name.endsWith(".html")) {
      const html = await readFile(join(root, name), "utf8");
      try {
        await write(name, finish(html, name));
      } catch (e) {
        warnings.push(`${name} was copied as it is: ${message(e)}`);
        await write(name, html);
      }
    } else if (name === "consent.js" && d.site) {
      await write(name, applyConsentJs(await readFile(join(root, name), "utf8"), d.site.ga4));
    } else {
      await copyFile(join(root, name), join(work, name));
    }
  }

  /* Library images: only the ones the site uses, so an image nobody has published never reaches it. */
  if (usedMedia.size) await mkdir(join(work, MEDIA_DIR), { recursive: true });
  for (const key of usedMedia) {
    const data = await storage.get(key);
    if (data) await writeFile(join(work, MEDIA_DIR, key), data);
    else warnings.push(`The image ${d.mediaRows.find((m) => m.key === key)?.fileName ?? key} is missing from storage, so it won't show.`);
  }

  /* Links that lead nowhere in this build */
  const missing = (href: string) => /^(guide|area)-[a-z0-9-]+\.html$/.test(href) && !written.has(href);
  if (d.menus) {
    const links = [...d.menus.header.links, d.menus.header.button, ...d.menus.footer.flatMap((c) => c.links)];
    for (const l of links) if (missing(l.href)) warnings.push(`Menu link "${l.label}" points to ${l.href}, which isn't in this build.`);
  }
  for (const r of d.redirectRows) if (missing(r.toPath)) warnings.push(`The redirect from ${r.fromPath} points to ${r.toPath}, which isn't in this build.`);
  // consent.js only loads the first consent-gated tag, so a GTM tag would never run. Changing that is a live-site decision.
  if (d.site?.gtm) warnings.push("The Google Tag Manager ID isn't applied to pages yet: the cookie consent script only loads the GA4 tag.");

  counts.files = written.size;
  return { result: { builtAt: new Date().toISOString(), counts, skipped, warnings }, drafts: fromDrafts };
}

/**
 * Builds the site into `<previewRoot>/.site-preview`. Works in a temporary folder and swaps it in only when everything
 * succeeded, so a failed build leaves the last good preview in place.
 */
export async function buildSite(db: Db, opts: { siteRoot: string; previewRoot: string; storage?: MediaStorage }): Promise<BuildResult> {
  const root = resolve(opts.siteRoot);
  const out = resolve(opts.previewRoot, PREVIEW_DIR);
  const work = resolve(opts.previewRoot, WORK_DIR);
  // The output folder gets deleted on every build, so the site must never be in it.
  const inside = (a: string, b: string) => a === b || a.startsWith(b + sep);
  for (const dir of [out, work, `${out}.old`]) {
    if (inside(root.toLowerCase(), dir.toLowerCase())) throw new Error("The preview folder can't be the site folder.");
  }

  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(work, { recursive: true });
  try {
    const { result } = await build(db, root, work, opts.storage ?? localDriver(env.mediaRoot));
    await swapIn(work, out);
    return result;
  } catch (e) {
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw e;
  }
}

/** Builds the site straight into `outDir` (a new folder outside the site) for Publish, and says which drafts it used. */
export async function buildSiteInto(db: Db, opts: { siteRoot: string; outDir: string; storage: MediaStorage }) {
  const root = resolve(opts.siteRoot);
  const out = resolve(opts.outDir);
  const inside = (a: string, b: string) => a === b || a.startsWith(b + sep);
  if (inside(out.toLowerCase(), root.toLowerCase()) || inside(root.toLowerCase(), out.toLowerCase())) {
    throw new Error("The build folder can't overlap the site folder.");
  }
  await mkdir(out, { recursive: true });
  return build(db, root, out, opts.storage);
}
