// Process areas: read an area from its page, render an area into an existing area page's markup (only the area's own
// places change; the guides band is built from the area's guides), and check areas sent by the admin.
import type { Block, MediaSrc } from "./blocks.ts";
import { articleBody, validateGuide, type GuideSeo } from "./guides.ts";

export type Area = { slug: string; title: string; summary: string; blocks: Block[]; seo: GuideSeo };
/** A guide as shown on its area page: a card with the title and the first sentence of the summary. */
export type AreaGuide = { slug: string; title: string; summary: string };

const ORIGIN = "https://liveaccess.ai";
export const areaUrl = (slug: string) => `${ORIGIN}/area-${slug}.html`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s: string) => s.replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const json = (s: string) => JSON.stringify(s).slice(1, -1).replace(/</g, "\\u003c");

/** The first sentence of a text (up to the first . ! or ? followed by a space or the end). */
export function firstSentence(s: string): string {
  return /^.*?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();
}

/** Reads an area's fields (not its blocks) from its page. */
export function areaFromPage(html: string): Omit<Area, "blocks"> {
  const one = (re: RegExp) => decode(re.exec(html)?.[1] ?? "");
  return {
    slug: one(/<link rel="canonical" href="https:\/\/liveaccess\.ai\/area-([a-z0-9-]+)\.html"/),
    title: one(/<h1>([^<]*)<\/h1>/),
    summary: one(/<p class="lede">([^<]*)<\/p>\n\s*<\/div>\n\s*<\/section>/),
    seo: { title: one(/<title>([^<]*)<\/title>/), description: one(/<meta name="description" content="([^"]*)"/), noindex: /<meta name="robots" content="[^"]*noindex/.test(html) }
  };
}

/** The guide cards on an area page, in page order (their text is the card text, i.e. already one sentence). */
export function guideCardsFromPage(html: string): AreaGuide[] {
  return [...html.matchAll(/<a class="feat feat-link" href="guide-([a-z0-9-]+)\.html"><span class="feat-note">Guide<\/span><h3 class="h3">([^<]*)<\/h3><p>([^<]*)<\/p><\/a>/g)]
    .map((m) => ({ slug: m[1]!, title: decode(m[2]!), summary: decode(m[3]!) }));
}

function guidesBand(name: string, guides: AreaGuide[]) {
  if (!guides.length) return "";
  const cards = guides.map((g) => `          <a class="feat feat-link" href="guide-${esc(g.slug)}.html"><span class="feat-note">Guide</span><h3 class="h3">${esc(g.title)}</h3><p>${esc(firstSentence(g.summary))}</p></a>\n`).join("");
  return `    <section class="band alt">
      <div class="wrap">
        <div class="sec-head">
          <span class="eyebrow">Troubleshooting guides</span>
          <h2>Guides for ${esc(name.toLowerCase())}.</h2>
        </div>
        <div class="feat-grid three">
${cards}        </div>
      </div>
    </section>

`;
}

/**
 * Puts an area into an area page's markup (`template` = any existing area page) with a guides band for `guides`.
 * Throws if the template isn't in the expected form. `doc` is any Document, used to sanitise inline HTML.
 */
export function renderAreaPage(template: string, a: Area, guides: AreaGuide[], doc?: Document, mediaSrc?: MediaSrc): string {
  const d = doc ?? (globalThis as { document?: Document }).document;
  if (!d) throw new Error("renderAreaPage needs a Document.");
  const url = areaUrl(a.slug);
  const desc = a.seo.description || a.summary;
  let out = template;
  const swap = (re: RegExp, fn: (...m: string[]) => string, what: string) => {
    const hits = out.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
    if (hits?.length !== 1) throw new Error(`This area template isn't in the expected form (${what}).`);
    out = out.replace(re, fn as (...a: string[]) => string);
  };

  swap(/<title>[^<]*<\/title>/, () => `<title>${esc(a.seo.title || `${a.title}: process area | LiveAccess`)}</title>`, "title");
  swap(/(<meta name="description" content=")[^"]*(" \/>)(\n  <meta name="robots" content="[^"]*" \/>)?/, (_m, x, y) =>
    `${x}${esc(desc)}${y}${a.seo.noindex ? `\n  <meta name="robots" content="noindex" />` : ""}`, "description");
  swap(/(<link rel="canonical" href=")[^"]*(")/, (_m, x, y) => `${x}${url}${y}`, "canonical");
  swap(/(<meta property="og:title" content=")[^"]*(")/, (_m, x, y) => `${x}${esc(`${a.title} | LiveAccess`)}${y}`, "og:title");
  swap(/(<meta property="og:description" content=")[^"]*(")/, (_m, x, y) => `${x}${esc(desc)}${y}`, "og:description");
  swap(/(<meta property="og:url" content=")[^"]*(")/, (_m, x, y) => `${x}${url}${y}`, "og:url");
  swap(/("name": )"(?:[^"\\]|\\.)*"(,\s*"item": )"https:\/\/liveaccess\.ai\/area-[a-z0-9-]+\.html"/, (_m, x, y) => `${x}"${json(a.title)}"${y}"${url}"`, "breadcrumb");

  swap(/(<a href="process-areas\.html">Process areas<\/a><span aria-hidden="true">\/<\/span><span>)[^<]*(<\/span><\/nav>)/, (_m, x, y) => `${x}${esc(a.title)}${y}`, "crumbs");
  swap(/<h1>[^<]*<\/h1>/, () => `<h1>${esc(a.title)}</h1>`, "h1");
  swap(/(<p class="lede">)[^<]*(<\/p>\n\s*<\/div>\n\s*<\/section>\n\s*<section class="band">)/, (_m, x, y) => `${x}${esc(a.summary)}${y}`, "lede");
  swap(/(<article class="article">\n([ \t]*))[\s\S]*?(\n[ \t]*<\/article>)/, (_m, x, indent, y) => `${x}${articleBody(a.blocks, d, indent!, "area", mediaSrc)}${y}`, "article");

  // The guides band sits between the article band and the CTA band; it's rebuilt (or left out) every time.
  swap(/(<\/article>\n[ \t]*<\/div>\n[ \t]*<\/section>\n\n)(?:    <section class="band alt">[\s\S]*?<\/section>\n\n)?(    <section class="cta-band dark">)/,
    (_m, x, y) => `${x}${guidesBand(a.title, guides)}${y}`, "guides band");
  swap(/(<section class="cta-band dark">\n\s*<div class="wrap">\n\s*<div>\n\s*<h2>Questions about )[^<]*(\?<\/h2>)/, (_m, x, y) => `${x}${esc(a.title.toLowerCase())}${y}`, "cta");
  return out;
}

export type AreaCheck = { ok: true; area: Area } | { ok: false; errors: Record<string, string> };

/** Checks an area sent by the admin: the same fields, blocks and limits as guides, without area and date. */
export function validateArea(input: unknown, doc: Document, opts: { partial?: boolean } = {}): AreaCheck {
  const r = validateGuide(input, new Set(), doc, { ...opts, kind: "area" });
  if (!r.ok) return r;
  const { slug, title, summary, blocks, seo } = r.guide;
  return { ok: true, area: { slug, title, summary, blocks, seo } };
}
