import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { importBlocks } from "../src/blocks.ts";
import { guideFromPage, renderGuidePage, slugify, validateGuide, type Guide } from "../src/guides.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const files = readdirSync(root).filter((f) => /^guide-[a-z0-9-]+\.html$/.test(f));
const page = (f: string) => readFileSync(join(root, f), "utf8");
const areas = { evaporation: "Evaporation", "liquid-processing": "Liquid processing", "high-shear-mixing": "High shear mixing", "spray-drying": "Spray drying", applications: "Applications" };
const doc = parseHTML("<!doctype html><html><body></body></html>").document;

/** The guide's data as the importer reads it. */
function data(f: string): Guide {
  const html = page(f);
  const { document } = parseHTML(html);
  return { ...guideFromPage(html), blocks: importBlocks(document.querySelector("article.article")!) };
}

describe("renderGuidePage", () => {
  it("rebuilds every real guide page byte-for-byte from its own data", () => {
    expect(files).toHaveLength(6);
    for (const f of files) {
      const g = data(f);
      // Some pages write apostrophes as &#x27; inside the article; the sanitiser writes "'". Browsers show both the same.
      const same = (s: string) => s.replace(/&#x27;/g, "'");
      expect(same(renderGuidePage(page(f), g, areas[g.areaSlug as keyof typeof areas], doc)), f).toBe(same(page(f)));
    }
  });

  it("writes new data only into the guide's own places, escaped", () => {
    const tpl = page("guide-evaporator-fouling.html");
    const g: Guide = {
      ...data("guide-evaporator-fouling.html"),
      slug: "new-pump-check", title: `Pump "noise" & <checks>`, summary: "Short & sweet.", areaSlug: "spray-drying", publishedDate: "2026-11-05",
      blocks: [{ type: "heading", level: 2, text: "Symptoms" }, { type: "list", style: "number", items: ["One", "<strong>Two</strong>"] }],
      seo: { title: "", description: "", noindex: true }
    };
    const out = renderGuidePage(tpl, g, "Spray drying", doc);
    expect(out).toContain(`<title>Pump &quot;noise&quot; &amp; &lt;checks&gt;</title>`);
    expect(out).toContain(`<h1>Pump &quot;noise&quot; &amp; &lt;checks&gt;</h1>`);
    expect(out).toContain(`<link rel="canonical" href="https://liveaccess.ai/guide-new-pump-check.html" />`);
    expect(out).toContain(`<meta name="description" content="Short &amp; sweet." />\n  <meta name="robots" content="noindex" />`);
    expect(out).toContain(`"headline": "Pump \\"noise\\" & \\u003cchecks>"`);
    expect(out).toContain(`<time datetime="2026-11-05">5 November 2026</time> · <a href="area-spray-drying.html">Spray drying</a>`);
    expect(out).toContain(`<ol>\n            <li>One</li>\n            <li><strong>Two</strong></li>\n          </ol>`);
    expect(out).not.toContain("Steam and hot concentrate");
    // The header, footer, CTA band and scripts are untouched.
    const keep = (s: string) => s.slice(s.indexOf('<section class="cta-band dark">'));
    expect(keep(out)).toBe(keep(tpl));
    expect(out.slice(0, out.indexOf("<title>"))).toBe(tpl.slice(0, tpl.indexOf("<title>")));
  });
});

describe("slugify", () => {
  it("makes a clean address from a title", () => {
    expect(slugify("Evaporator fouling & falling capacity: causes!")).toBe("evaporator-fouling-falling-capacity-causes");
    expect(slugify("  Café   crème  ")).toBe("cafe-creme");
    expect(slugify("x".repeat(120)).length).toBeLessThanOrEqual(80);
  });
});

describe("validateGuide", () => {
  const areaSet = new Set(Object.keys(areas));
  const good = () => data("guide-evaporator-fouling.html");

  it("accepts a real guide and sanitises inline HTML", () => {
    const g = good();
    g.blocks.push({ type: "paragraph", html: `Hi <script>alert(1)</script><a href="javascript:x" onclick="y">x</a>` });
    const r = validateGuide(g, areaSet, doc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const last = r.guide.blocks.at(-1);
      expect(last?.type === "paragraph" && last.html).not.toMatch(/script|javascript|onclick/);
    }
  });

  it("refuses bad fields, unknown areas and block types the site can't show", () => {
    const g = { ...good(), title: "", slug: "Bad Slug", summary: "x".repeat(301), areaSlug: "nope", publishedDate: "29/10/2026",
      blocks: [{ type: "image", mediaId: 1, position: "full", alt: "", caption: "" }, { type: "heading", level: 4, text: "x" }] };
    const r = validateGuide(g, areaSet, doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["areaSlug", "blocks.0", "blocks.1", "publishedDate", "slug", "summary", "title"]);
  });

  it("lets auto-save keep an unfinished draft, but still refuses unsafe or oversized input", () => {
    const draft = { ...good(), title: "", summary: "", areaSlug: "", blocks: [{ type: "heading", level: 2, text: "" }, { type: "list", style: "bullet", items: [""] }, { type: "paragraph", html: "" }] };
    const r = validateGuide(draft, areaSet, doc, { partial: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.guide.blocks).toHaveLength(3);
    expect(validateGuide(draft, areaSet, doc).ok).toBe(false);
    for (const bad of [{ title: "x".repeat(121) }, { slug: "Bad Slug" }, { areaSlug: "nope" }, { blocks: [{ type: "quote" }] }, { publishedDate: "x" }]) {
      expect(validateGuide({ ...draft, ...bad }, areaSet, doc, { partial: true }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses hidden characters in block text and caps the total text", () => {
    const hidden = validateGuide({ ...good(), blocks: [{ type: "paragraph", html: "Safe‮txt.exe" }] }, areaSet, doc, { partial: true });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.errors["blocks.0"]).toMatch(/hidden/);
    const big = Array.from({ length: 80 }, () => ({ type: "paragraph", html: "x".repeat(2900) }));
    const r = validateGuide({ ...good(), blocks: big }, areaSet, doc, { partial: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.blocks).toMatch(/too long/);
  });

  it("needs at least one block and caps lists and block counts", () => {
    expect(validateGuide({ ...good(), blocks: [] }, areaSet, doc).ok).toBe(false);
    const many = Array.from({ length: 201 }, () => ({ type: "paragraph", html: "x" }));
    expect(validateGuide({ ...good(), blocks: many }, areaSet, doc).ok).toBe(false);
    expect(validateGuide({ ...good(), blocks: [{ type: "list", style: "bullet", items: [] }] }, areaSet, doc).ok).toBe(false);
    expect(validateGuide(null, areaSet, doc).ok).toBe(false);
  });
});
