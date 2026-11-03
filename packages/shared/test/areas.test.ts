import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { importBlocks } from "../src/blocks.ts";
import { areaFromPage, firstSentence, guideCardsFromPage, renderAreaPage, validateArea, type Area } from "../src/areas.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const files = readdirSync(root).filter((f) => /^area-[a-z0-9-]+\.html$/.test(f));
const page = (f: string) => readFileSync(join(root, f), "utf8");
const doc = parseHTML("<!doctype html><html><body></body></html>").document;
const data = (f: string): Area => ({ ...areaFromPage(page(f)), blocks: importBlocks(parseHTML(page(f)).document.querySelector("article.article")!) });
// Apostrophes may be written as &#x27; in the article; the sanitiser writes "'". Browsers show both the same.
const same = (s: string) => s.replace(/&#x27;/g, "'");

describe("renderAreaPage", () => {
  it("rebuilds every real area page byte-for-byte from its own data and guide cards", () => {
    expect(files).toHaveLength(8);
    for (const f of files) {
      const html = page(f);
      expect(same(renderAreaPage(html, data(f), guideCardsFromPage(html), doc)), f).toBe(same(html));
    }
  });

  it("adds, changes and removes the guides band and writes new data escaped", () => {
    const withGuides = page("area-evaporation.html");
    const without = page("area-ingredients.html");
    const a: Area = { ...data("area-ingredients.html"), slug: "dairy-desserts", title: `Dairy & "desserts"`, summary: "Puddings <and> custards.", seo: { title: "", description: "", noindex: false } };
    const guides = [{ slug: "pump-check", title: "Pump <check>", summary: "First sentence. Second sentence." }];

    const added = renderAreaPage(without, a, guides, doc);
    expect(added).toContain(`<h2>Guides for dairy &amp; &quot;desserts&quot;.</h2>`);
    expect(added).toContain(`<a class="feat feat-link" href="guide-pump-check.html"><span class="feat-note">Guide</span><h3 class="h3">Pump &lt;check&gt;</h3><p>First sentence.</p></a>`);
    expect(added).toContain(`<h2>Questions about dairy &amp; &quot;desserts&quot;?</h2>`);
    expect(added).toContain(`<title>Dairy &amp; &quot;desserts&quot;: process area | LiveAccess</title>`);
    expect(added).toContain(`<meta property="og:title" content="Dairy &amp; &quot;desserts&quot; | LiveAccess" />`);
    expect(added).toContain(`<link rel="canonical" href="https://liveaccess.ai/area-dairy-desserts.html" />`);
    expect(added).toContain(`"name": "Dairy & \\"desserts\\"",\n            "item": "https://liveaccess.ai/area-dairy-desserts.html"`);
    expect(added).toContain(`<p class="lede">Puddings &lt;and&gt; custards.</p>`);

    const removed = renderAreaPage(withGuides, { ...data("area-evaporation.html") }, [], doc);
    expect(removed).not.toContain(`class="band alt"`);
    expect(removed).toContain(`</section>\n\n    <section class="cta-band dark">`);
  });

  it("takes the first sentence for guide cards", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("Is it? Yes.")).toBe("Is it?");
    expect(firstSentence("No full stop")).toBe("No full stop");
  });
});

describe("validateArea", () => {
  it("accepts a real area and ignores guide-only fields", () => {
    const r = validateArea(data("area-evaporation.html"), doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.area).not.toHaveProperty("areaSlug");
  });

  it("refuses bad fields and allows unfinished drafts in partial mode", () => {
    const bad = validateArea({ ...data("area-evaporation.html"), title: "", slug: "Bad Slug", blocks: [{ type: "image" }] }, doc);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["blocks.0", "slug", "title"]);
    expect(validateArea({ ...data("area-evaporation.html"), title: "", summary: "", blocks: [] }, doc, { partial: true }).ok).toBe(true);
  });
});
