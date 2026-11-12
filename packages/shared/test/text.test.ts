import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeInline, sanitizeText, plainText } from "../src/sanitize.ts";
import { blockHtml } from "../src/blocks.ts";
import { articleBody, validateGuide } from "../src/guides.ts";
import { renderAreaPage, validateArea } from "../src/areas.ts";

const doc = parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;
const text = (html: string) => sanitizeText(html, doc);

describe("sanitizeText", () => {
  it("keeps the text styles, on inline tags only", () => {
    const html = `a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <span style="color:#C2410C;font-size:18px">f</span>`;
    expect(text(html)).toBe(html);
    expect(text(`<span style="font-family:Georgia">a</span>`)).toBe(`<span style="font-family:Georgia,serif">a</span>`);
    expect(text(`<strong style="background-color:rgb(255, 0, 170)">a</strong>`)).toBe(`<strong style="background-color:#FF00AA">a</strong>`);
  });

  it("gives exactly what sanitizeInline gives for text without the extras", () => {
    for (const html of ["plain", "a <strong>b</strong> <em class=\"hl\">c</em>", `<a href="faq.html" class="link">x</a>`, `<span class="num">1</span> x`,
      `<small class="muted">s</small>`, `<time datetime="2026-11-12">12 Nov</time>`, "a<br>b", "a &amp; b &lt;c&gt;", `<span>bare</span>`,
      `<span style="position:fixed">x</span>`, `<p>block</p><ul><li>item</li></ul>`]) {
      expect(text(html), html).toBe(sanitizeInline(html, doc));
    }
  });

  it("gives what sanitizeInline gives for every text field of every site page", () => {
    const root = join(import.meta.dirname, "../../..");
    const pages = readdirSync(root).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      const { document } = parseHTML(readFileSync(join(root, page), "utf8"));
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        expect(sanitizeText(el.innerHTML, document as unknown as Document), `${page} ${el.tagName}`).toBe(sanitizeInline(el.innerHTML, document as unknown as Document));
      }
    }
  });

  it("drops block tags and alignment, keeping the text", () => {
    expect(text(`<p style="text-align:center">a</p><ul><li>b</li></ul><table><tr><td>c</td></tr></table><div>d</div>`)).toBe("abcd");
    expect(text(`<span style="text-align:center;color:#C2410C">a</span>`)).toBe(`<span style="color:#C2410C">a</span>`);
    expect(text(`<img src="images/cms/0123456789abcdef0123456789abcdef.webp" alt="x">a`)).toBe("a");
  });

  it("removes anything off the style lists", () => {
    for (const style of ["color:red", "color:rgb(999,0,0)", "background-color:url(x)", "color:expression(alert(1))", "font-size:13px", "font-size:2em",
      "font-family:Comic Sans MS", "position:fixed", "background:url(https://evil.example/x.png)", "color:#C2410C !important", "__proto__:x", "display:block"]) {
      expect(text(`<span style="${style}">a</span>`), style).toBe("<span>a</span>");
      expect(text(`<u style="${style}">a</u>`), style).toBe("<u>a</u>");
    }
  });

  it("never keeps styles on links, line breaks or times", () => {
    expect(text(`<a href="faq.html" style="color:#C2410C">a</a><br style="color:#C2410C"><time datetime="2026-01-01" style="color:#C2410C">t</time>`))
      .toBe(`<a href="faq.html">a</a><br><time datetime="2026-01-01">t</time>`);
  });

  it("removes scripts, events and unsafe links", () => {
    const out = text(`<u onclick="x()">a</u><s onmouseover="y">b</s><script>alert(1)</script><img src=x onerror=z><a href="javascript:alert(1)">c</a><svg><script>d</script></svg><style>u{}</style><base href="https://evil.example/">`);
    expect(out).not.toMatch(/script|onclick|onerror|onmouseover|svg|style|javascript|base/i);
    expect(out).toBe("<u>a</u><s>b</s><a>c</a>");
  });

  it("survives hostile nesting and stays fast", () => {
    expect(text("<u>".repeat(5000) + "x")).toContain("x");
    expect(text("<s>".repeat(120) + "x")).toContain("x");
    expect(text("<b/>".repeat(3000) + "x")).toContain("x");
    const start = performance.now();
    text("<" + "a".repeat(39_999));
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("gives the same answer when it runs twice", () => {
    for (const html of [`<span style="color: rgb(1, 2, 3); font-size: 18px">a</span>`, "<u><s>a</s></u>", `<span style="font-family:'IBM Plex Mono', monospace">a</span>`]) {
      expect(text(text(html)), html).toBe(text(html));
    }
  });
});

const styled = `<span style="color:#C2410C;font-size:18px">Hot</span> <u>water</u>`;
const guide = (blocks: unknown[]) => ({ slug: "a", title: "A", summary: "S", areaSlug: "x", publishedDate: "2026-11-12", seo: { title: "", description: "", noindex: false }, blocks });

describe("text-editor fields in guides and areas", () => {
  it("keep their formatting in list items, safety notes and disclaimers", () => {
    const r = validateGuide(guide([
      { type: "list", style: "bullet", items: [`${styled}<script>x</script>`, `<span style="position:fixed">b</span>`] },
      { type: "callout", variant: "safety", title: "<em>Safety</em>", text: styled },
      { type: "callout", variant: "disclaimer", title: "", text: `<p style="text-align:center">${styled}</p>` }
    ]), new Set(["x"]), doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.guide.blocks).toEqual([
      { type: "list", style: "bullet", items: [styled, "<span>b</span>"] },
      { type: "callout", variant: "safety", title: "<em>Safety</em>", text: styled },
      { type: "callout", variant: "disclaimer", title: "", text: styled }
    ]);
    expect(blockHtml(r.guide.blocks[0]!, doc)).toBe(`<ul><li>${styled}</li><li><span>b</span></li></ul>`);
    expect(blockHtml(r.guide.blocks[1]!, doc)).toBe(`<div class="note note-safety" role="note"><strong>&lt;em&gt;Safety&lt;/em&gt;</strong> ${styled}</div>`);
    expect(blockHtml(r.guide.blocks[2]!, doc)).toBe(`<p class="article-note">${styled}</p>`);
    expect(articleBody(r.guide.blocks.slice(0, 1), doc, "")).toBe(`<ul>\n  <li>${styled}</li>\n  <li><span>b</span></li>\n</ul>`);
  });

  it("clean styles again when published, even if the stored text wasn't", () => {
    expect(blockHtml({ type: "list", style: "number", items: [`<span style="background:url(x)" onclick="y">a</span>`] }, doc)).toBe("<ol><li><span>a</span></li></ol>");
  });

  it("keep the guide summary plain", () => {
    const r = validateGuide({ ...guide([{ type: "paragraph", html: "p" }]), summary: styled }, new Set(["x"]), doc);
    expect(r.ok && r.guide.summary).toBe(styled.replace(/\s+/g, " "));
    // Plain text, escaped when published (unchanged behaviour).
  });
});

describe("area intro line", () => {
  const area = (summary: unknown) => ({ slug: "automation", title: "Automation", summary, seo: { title: "", description: "", noindex: false }, blocks: [{ type: "paragraph", html: "p" }] });

  it("keeps the text editor's formatting and drops the rest", () => {
    const r = validateArea(area(`<p>${styled}<img src=x onerror=y></p>`), doc);
    expect(r.ok && r.area.summary).toBe(styled);
  });

  it("counts the words people see, not the formatting", () => {
    const words = "x".repeat(300);
    expect(validateArea(area(`<span style="color:#C2410C;font-size:18px;font-family:Georgia">${words}</span>`), doc).ok).toBe(true);
    const long = validateArea(area("x".repeat(301)), doc);
    expect(!long.ok && long.errors.summary).toMatch(/300/);
    const heavy = validateArea(area(`<u>x</u>`.repeat(700)), doc);
    expect(!heavy.ok && heavy.errors.summary).toMatch(/formatting/);
  });

  it("is required when complete, and empty formatting counts as empty", () => {
    const r = validateArea(area(`<span style="color:#C2410C"> </span><br>`), doc);
    expect(!r.ok && r.errors.summary).toMatch(/required/);
    const draft = validateArea(area(`<u></u>`), doc, { partial: true });
    expect(draft.ok && draft.area.summary).toBe("");
  });

  it("shows formatted on the page, and as plain words in meta and og tags", () => {
    const root = join(import.meta.dirname, "../../..");
    const template = readFileSync(join(root, "area-automation.html"), "utf8");
    const html = renderAreaPage(template, { ...area(`Fast & <span style="color:#C2410C">safe</span> "lines"`), blocks: [] } as never, [], doc);
    expect(html).toContain(`<p class="lede">Fast &amp; <span style="color:#C2410C">safe</span> "lines"</p>`);
    expect(html).toContain(`<meta name="description" content="Fast &amp; safe &quot;lines&quot;" />`);
    expect(html).toContain(`<meta property="og:description" content="Fast &amp; safe &quot;lines&quot;"`);
    expect(html).not.toMatch(/content="[^"]*<span/);
  });

  it("gives plain text for places that can't show formatting", () => {
    expect(plainText(`<span style="color:#C2410C">a</span>  &amp; <u>b</u><script>c</script>`, doc)).toBe("a & b");
  });
});
