// Troubleshooting guides: read a guide from its page, render a guide into an existing guide page's markup
// (only the guide's own places change, so the layout stays as it is), and check guides sent by the admin.
import { blockHtml, type Block } from "./blocks.ts";
import { hasHiddenChars } from "./links.ts";
import { normalizeSpace, sanitizeInline } from "./sanitize.ts";

export type GuideSeo = { title: string; description: string; noindex: boolean };
export type Guide = { slug: string; title: string; summary: string; areaSlug: string; publishedDate: string; blocks: Block[]; seo: GuideSeo };

const ORIGIN = "https://liveaccess.ai";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const guideUrl = (slug: string) => `${ORIGIN}/guide-${slug}.html`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s: string) => s.replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** A JSON string body safe inside <script>: JSON escaping plus "<" as <. */
const json = (s: string) => JSON.stringify(s).slice(1, -1).replace(/</g, "\\u003c");
const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Reads a guide's fields (not its blocks) from its page. */
export function guideFromPage(html: string): Omit<Guide, "blocks"> {
  const one = (re: RegExp) => decode(re.exec(html)?.[1] ?? "");
  return {
    slug: one(/<link rel="canonical" href="https:\/\/liveaccess\.ai\/guide-([a-z0-9-]+)\.html"/),
    title: one(/<h1>([^<]*)<\/h1>/),
    summary: one(/<p class="lede">([^<]*)<\/p>/),
    areaSlug: one(/<p class="byline">[^\n]*?<a href="area-([a-z0-9-]+)\.html">/),
    publishedDate: one(/<p class="byline">[^\n]*?<time datetime="(\d{4}-\d{2}-\d{2})">/),
    seo: { title: one(/<title>([^<]*)<\/title>/), description: one(/<meta name="description" content="([^"]*)"/), noindex: /<meta name="robots" content="[^"]*noindex/.test(html) }
  };
}

/** The article body in the pages' own layout (one block per line group, list items indented). */
export function articleBody(blocks: Block[], doc: Document, indent: string, spacing: "guide" | "area" = "guide") {
  const parts = blocks.map((b) => {
    if (b.type !== "list") return blockHtml(b, doc);
    const t = b.style === "number" ? "ol" : "ul";
    const items = b.items.filter((x) => x.trim()).map((x) => `\n${indent}  <li>${sanitizeInline(x, doc)}</li>`).join("");
    return `<${t}>${items}\n${indent}</${t}>`;
  });
  // As in the pages. Guides: a heading sits right above its first block, other blocks are separated by a blank line.
  // Areas: a blank line only before each heading.
  const blank = (i: number) => spacing === "area" ? blocks[i]!.type === "heading" : blocks[i - 1]!.type !== "heading";
  return parts.map((p, i) => (i === 0 ? p : `${blank(i) ? "\n\n" : "\n"}${indent}${p}`)).join("");
}

/**
 * Puts a guide into a guide page's markup (`template` = any existing guide page). Throws if the template isn't in the
 * expected form, instead of guessing. `doc` is any Document (the browser's or linkedom's), used to sanitise inline HTML.
 */
export function renderGuidePage(template: string, g: Guide, areaName: string, doc?: Document): string {
  const d = doc ?? (globalThis as { document?: Document }).document;
  if (!d) throw new Error("renderGuidePage needs a Document.");
  const url = guideUrl(g.slug);
  const title = g.title, desc = g.seo.description || g.summary;
  let out = template;
  const swap = (re: RegExp, fn: (...m: string[]) => string, what: string) => {
    const hits = out.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
    if (hits?.length !== 1) throw new Error(`This guide template isn't in the expected form (${what}).`);
    out = out.replace(re, fn as (...a: string[]) => string);
  };

  swap(/<title>[^<]*<\/title>/, () => `<title>${esc(g.seo.title || title)}</title>`, "title");
  swap(/(<meta name="description" content=")[^"]*(" \/>)(\n  <meta name="robots" content="[^"]*" \/>)?/, (_m, a, b) =>
    `${a}${esc(desc)}${b}${g.seo.noindex ? `\n  <meta name="robots" content="noindex" />` : ""}`, "description");
  swap(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`, "canonical");
  swap(/(<meta property="og:title" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(title)}${b}`, "og:title");
  swap(/(<meta property="og:description" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(desc)}${b}`, "og:description");
  swap(/(<meta property="og:url" content=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`, "og:url");

  // JSON-LD: the article and the last breadcrumb.
  const str = `"(?:[^"\\\\]|\\\\.)*"`;
  swap(new RegExp(`("headline": )${str}`), (_m, a) => `${a}"${json(title)}"`, "headline");
  swap(new RegExp(`("description": )${str}`), (_m, a) => `${a}"${json(desc)}"`, "ld description");
  swap(new RegExp(`("url": )"https://liveaccess\\.ai/guide-[a-z0-9-]+\\.html"`), (_m, a) => `${a}"${url}"`, "ld url");
  swap(/("datePublished": )"[^"]*"/, (_m, a) => `${a}"${g.publishedDate}"`, "datePublished");
  swap(/("dateModified": )"[^"]*"/, (_m, a) => `${a}"${g.publishedDate}"`, "dateModified");
  swap(new RegExp(`("about": )${str}`), (_m, a) => `${a}"${json(areaName)}"`, "about");
  swap(new RegExp(`("name": )${str}(,\\s*"item": )"https://liveaccess\\.ai/guide-[a-z0-9-]+\\.html"`), (_m, a, b) => `${a}"${json(title)}"${b}"${url}"`, "breadcrumb");

  // Page hero.
  swap(/(<a href="guides\.html">Guides<\/a><span aria-hidden="true">\/<\/span><span>)[^<]*(<\/span><\/nav>)/, (_m, a, b) => `${a}${esc(title)}${b}`, "crumbs");
  swap(/<h1>[^<]*<\/h1>/, () => `<h1>${esc(title)}</h1>`, "h1");
  swap(/(<p class="lede">)[^<]*(<\/p>\n\s*<p class="byline">)/, (_m, a, b) => `${a}${esc(g.summary)}${b}`, "lede");
  swap(/(<p class="byline">[^<]*<time datetime=")[^"]*(">)[^<]*(<\/time> · <a href=")area-[a-z0-9-]+\.html(">)[^<]*(<\/a><\/p>)/,
    (_m, a, b, c, e, f) => `${a}${g.publishedDate}${b}${longDate(g.publishedDate)}${c}area-${g.areaSlug}.html${e}${esc(areaName)}${f}`, "byline");

  // Article body.
  swap(/(<article class="article">\n([ \t]*))[\s\S]*?(\n[ \t]*<\/article>)/, (_m, a, indent, b) => `${a}${articleBody(g.blocks, d, indent!)}${b}`, "article");
  return out;
}

export function slugify(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

/* ---------- validation ---------- */

export type GuideCheck = { ok: true; guide: Guide } | { ok: false; errors: Record<string, string> };
export const GUIDE_LIMITS = { title: 120, summary: 300, blocks: 200, listItems: 50, inline: 3000, total: 100_000, slug: 80 } as const;

/**
 * Checks a guide sent by the admin. `areas` = allowed process area slugs; `doc` sanitises inline HTML.
 * `partial` (auto-save of a draft): empty fields and empty blocks are allowed, but types, limits, the slug format and
 * sanitising still apply. Without it, the guide must also be complete (what Publish needs).
 */
export function validateGuide(input: unknown, areas: Set<string>, doc: Document, opts: { partial?: boolean; kind?: "guide" | "area" } = {}): GuideCheck {
  const need = !opts.partial;
  // Process areas share everything except the area and date fields (see areas.ts).
  const isGuide = (opts.kind ?? "guide") === "guide";
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!o) return { ok: false, errors: { guide: "Invalid guide." } };
  const errors: Record<string, string> = {};
  const text = (v: unknown, key: string, label: string, max: number, required = true) => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    if (!s && required && need) errors[key] = `${label} is required.`;
    else if (s.length > max) errors[key] = `${label} can be at most ${max} characters.`;
    else if (hasHiddenChars(s)) errors[key] = "Remove the hidden characters.";
    return s;
  };
  // Total inline text across the guide is capped, so one request can't make the server sanitise without limit.
  // `hidden` is set when the text has control or direction-changing characters (checked per block below).
  let total = 0, hidden = false;
  const inline = (v: unknown) => {
    if (typeof v !== "string") return "";
    total += v.length;
    if (total > GUIDE_LIMITS.total) return "";
    if (hasHiddenChars(v)) hidden = true;
    return normalizeSpace(sanitizeInline(v.slice(0, GUIDE_LIMITS.inline * 2), doc));
  };

  const title = text(o.title, "title", "Title", GUIDE_LIMITS.title);
  const summary = text(o.summary, "summary", "Summary", GUIDE_LIMITS.summary);
  const slug = typeof o.slug === "string" ? o.slug.trim() : "";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > GUIDE_LIMITS.slug) errors.slug = "Use lower-case letters, numbers and single hyphens (e.g. pump-cavitation).";
  const areaSlug = isGuide && typeof o.areaSlug === "string" && areas.has(o.areaSlug) ? o.areaSlug : "";
  if (isGuide && !areaSlug && (need || o.areaSlug !== "")) errors.areaSlug = "Choose a process area.";
  const publishedDate = isGuide && typeof o.publishedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.publishedDate) && !Number.isNaN(Date.parse(o.publishedDate)) ? o.publishedDate : "";
  if (isGuide && !publishedDate) errors.publishedDate = "Choose a date.";

  const seoIn = (o.seo && typeof o.seo === "object" ? o.seo : {}) as Record<string, unknown>;
  const seo: GuideSeo = {
    title: text(seoIn.title, "seo.title", "Meta title", 200, false),
    description: text(seoIn.description, "seo.description", "Meta description", 500, false),
    noindex: seoIn.noindex === true
  };

  const raw = Array.isArray(o.blocks) ? o.blocks : null;
  if (!raw || (raw.length === 0 && need)) errors.blocks = "Add at least one block.";
  else if (raw.length > GUIDE_LIMITS.blocks) errors.blocks = `At most ${GUIDE_LIMITS.blocks} blocks.`;
  const blocks: Block[] = [];
  (raw ?? []).slice(0, GUIDE_LIMITS.blocks).forEach((item, i) => {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const bad = (msg: string) => { errors[`blocks.${i}`] = msg; };
    hidden = false;
    if (b.type === "heading") {
      const t = text(b.text, `blocks.${i}`, "Heading", 200);
      if (b.level !== 2 && b.level !== 3) bad("Choose heading level 2 or 3.");
      blocks.push({ type: "heading", level: b.level === 3 ? 3 : 2, text: t });
    } else if (b.type === "paragraph") {
      const html = inline(b.html);
      if (!html && need) bad("Paragraph is empty.");
      else if (html.length > GUIDE_LIMITS.inline) bad(`Paragraph can be at most ${GUIDE_LIMITS.inline} characters.`);
      blocks.push({ type: "paragraph", html });
    } else if (b.type === "list") {
      // Drafts keep empty items (a new, still empty row); complete guides drop them.
      const all = Array.isArray(b.items) ? b.items.slice(0, GUIDE_LIMITS.listItems + 1).map(inline) : [];
      const items = need ? all.filter(Boolean) : all;
      if (!items.some(Boolean) && need) bad("Add at least one list item.");
      else if (items.length > GUIDE_LIMITS.listItems) bad(`At most ${GUIDE_LIMITS.listItems} items in a list.`);
      else if (items.some((x) => x.length > GUIDE_LIMITS.inline)) bad("A list item is too long.");
      blocks.push({ type: "list", style: b.style === "number" ? "number" : "bullet", items });
    } else if (b.type === "callout" && (b.variant === "safety" || b.variant === "disclaimer")) {
      const t = inline(b.text);
      if (!t && need) bad("Note text is empty.");
      const ttl = b.variant === "safety" ? text(b.title, `blocks.${i}`, "Note title", 80, false) : "";
      blocks.push({ type: "callout", variant: b.variant, title: ttl, text: t });
    } else {
      bad("This block type can't be used in guides yet.");
    }
    if (hidden) bad("Remove the hidden characters from this block.");
  });
  if (total > GUIDE_LIMITS.total) errors.blocks = `The guide is too long (max ${GUIDE_LIMITS.total.toLocaleString("en")} characters of text).`;

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, guide: { slug, title, summary, areaSlug, publishedDate, blocks, seo } };
}
