import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { blockHtml } from "../src/blocks.ts";
import { validateGuide } from "../src/guides.ts";
import { cleanParagraph, sanitizeInline, sanitizeRich } from "../src/sanitize.ts";

const doc = parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;
const rich = (html: string) => sanitizeRich(html, doc);

describe("sanitizeRich", () => {
  it("keeps the agreed structure and text styles", () => {
    const html = "<p>One <strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p><ul><li>a</li></ul><ol><li>b</li></ol>";
    expect(rich(html)).toBe(html);
  });

  it("keeps only the agreed style values, in one written form", () => {
    expect(rich(`<p><span style="color:#c2410c">a</span></p>`)).toBe(`<p><span style="color:#C2410C">a</span></p>`);
    expect(rich(`<p><span style="color: rgb(30, 58, 95)">a</span></p>`)).toBe(`<p><span style="color:#1E3A5F">a</span></p>`);
    expect(rich(`<p><span style="background-color:#FFF1EA">a</span></p>`)).toBe(`<p><span style="background-color:#FFF1EA">a</span></p>`);
    expect(rich(`<p><span style="font-size:18px">a</span></p>`)).toBe(`<p><span style="font-size:18px">a</span></p>`);
    expect(rich(`<p><span style="font-family:'IBM Plex Mono', monospace">a</span></p>`)).toBe(`<p><span style="font-family:'IBM Plex Mono',monospace">a</span></p>`);
    expect(rich(`<p><span style="font-family:Georgia">a</span></p>`)).toBe(`<p><span style="font-family:Georgia,serif">a</span></p>`);
    expect(rich(`<p style="text-align:center">a</p>`)).toBe(`<p style="text-align:center">a</p>`);
    expect(rich(`<p><span style="color:#C2410C;font-size:24px">a</span></p>`)).toBe(`<p><span style="color:#C2410C;font-size:24px">a</span></p>`);
  });

  it("removes anything off the lists, and the span if nothing is left", () => {
    for (const style of ["color:red", "color:hsl(0,100%,50%)", "color:rgb(999,0,0)", "color:rgb(1,2)", "color:rgba(0,0,0,0.5)", "color:#GGGGGG", "color:#12345", "background-color:url(x)", "color:expression(alert(1))", "font-size:13px", "font-size:100px", "font-size:2em",
      "font-family:Comic Sans MS", "text-align:justify", "position:fixed", "background:url(https://evil.example/x.png)", "color:#C2410C !important",
      "color:/**/#C2410C", "width:100%", "__proto__:x", "constructor:x"]) {
      expect(rich(`<p><span style="${style}">a</span></p>`), style).toBe("<p>a</p>");
    }
  });

  it("accepts any solid colour for text and background, in one written form", () => {
    expect(rich(`<p><span style="color:#ff00aa">a</span></p>`)).toBe(`<p><span style="color:#FF00AA">a</span></p>`);
    expect(rich(`<p><span style="color:#f0a">a</span></p>`)).toBe(`<p><span style="color:#FF00AA">a</span></p>`);
    expect(rich(`<p><span style="background-color:rgb(255, 0, 170)">a</span></p>`)).toBe(`<p><span style="background-color:#FF00AA">a</span></p>`);
    expect(rich(`<p><span style="color:rgb(0,0,0)">a</span></p>`)).toBe(`<p><span style="color:#000000">a</span></p>`);
  });

  it("keeps Jodit's full size and font lists", () => {
    for (const size of [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 32, 34, 36, 48, 60, 72, 96]) {
      expect(rich(`<p><span style="font-size:${size}px">a</span></p>`), String(size)).toBe(`<p><span style="font-size:${size}px">a</span></p>`);
    }
    expect(rich(`<p><span style="font-family:'Times New Roman', Times, serif">a</span></p>`)).toBe(`<p><span style="font-family:'Times New Roman',Times,serif">a</span></p>`);
    expect(rich(`<p><span style="font-family:Verdana, Geneva, sans-serif">a</span></p>`)).toBe(`<p><span style="font-family:Verdana,Geneva,sans-serif">a</span></p>`);
  });

  it("drops a styled span with nothing in it", () => {
    expect(rich(`<p><span style="color:#FF00AA"></span>a</p>`)).toBe("<p>a</p>");
  });

  it("keeps the allowed part of a mixed style", () => {
    expect(rich(`<p><span style="position:fixed;font-size:18px;top:0">a</span></p>`)).toBe(`<p><span style="font-size:18px">a</span></p>`);
  });

  it("removes scripts, events, unsafe links and unknown tags", () => {
    const out = rich(`<p onclick="x()">a<script>alert(1)</script><img src=x onerror=y><iframe src="//evil"></iframe>` +
      `<a href="javascript:alert(1)" onmouseover="z">b</a><svg><script>c</script></svg><math><mtext>m</mtext></math><style>p{}</style></p>`);
    expect(out).not.toMatch(/script|onclick|onerror|onmouseover|iframe|img|svg|style|javascript/i);
    expect(out).toContain("a");
  });

  it("keeps safe links, and sets rel on new-tab links", () => {
    expect(rich(`<p><a href="https://liveaccess.ai/" class="btn">a</a></p>`)).toBe(`<p><a href="https://liveaccess.ai/">a</a></p>`);
    expect(rich(`<p><a href="guides.html" target="_blank">a</a></p>`)).toBe(`<p><a href="guides.html" target="_blank" rel="noopener noreferrer">a</a></p>`);
  });

  it("drops classes, so a paragraph can't borrow the site's layout", () => {
    expect(rich(`<p class="btn"><span class="hero">a</span></p>`)).toBe("<p>a</p>");
  });

  it("gives tables the site's class, and keeps cells to inline text with no merged cells", () => {
    const out = rich(`<table style="width:100%" border="1"><tbody><tr><td style="width:50%" colspan="2" rowspan="3"><p>a</p><table><tr><td>b</td></tr></table></td><th style="text-align:right"><strong>c</strong></th></tr></tbody></table>`);
    expect(out).toBe(`<table class="cms-table"><tbody><tr><td>ab</td><th style="text-align:right"><strong>c</strong></th></tr></tbody></table>`);
  });

  it("survives hostile nesting", () => {
    expect(rich("<p>".repeat(5000) + "x")).toContain("x");
    expect(rich("<span>".repeat(300) + "x")).toContain("x");
    // Below the raw-string check, so the walker's own depth limit has to hold.
    expect(rich("<strong>".repeat(120) + "x")).toContain("x");
    // Tags a parser nests but a simple count doesn't.
    expect(rich("<b/>".repeat(3000) + "x")).toContain("x");
    expect(rich("<b></i>".repeat(3000) + "x")).toContain("x");
    expect(sanitizeInline("<b/>".repeat(3000) + "x", doc)).toContain("x");
  });

  it("stays fast on an unclosed tag", () => {
    const start = performance.now();
    rich("<" + "a".repeat(39_999));
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("removes data:, vbscript: and encoded script links", () => {
    for (const href of ["data:text/html,x", "vbscript:x", "javascript&#58;alert(1)", "&#106;avascript:alert(1)", " javascript:alert(1)", "//evil.example/x"]) {
      expect(rich(`<p><a href="${href}">a</a></p>`), href).toBe("<p><a>a</a></p>");
    }
  });

  it("never copies a value from the input", () => {
    expect(rich(`<p><span style="font-size:012px">a</span></p>`)).toBe(`<p><span style="font-size:12px">a</span></p>`);
    for (const name of ["__proto__", "constructor", "toString"]) expect(rich(`<p><span style="font-family:${name}">a</span></p>`), name).toBe("<p>a</p>");
  });

  it("removes tags that can change the page around the editor", () => {
    expect(rich(`<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="x"><form action="x"><p>a</p></form>`)).toBe("<p>a</p>");
  });
});

describe("cleanParagraph", () => {
  const clean = (html: string) => cleanParagraph(html, doc);

  it("leaves plain paragraphs exactly as they are stored today", () => {
    expect(clean("Some <strong>bold</strong> text &amp; more")).toBe("Some <strong>bold</strong> text &amp; more");
    expect(clean("")).toBe("");
  });

  it("stores a single plain paragraph without the editor's <p>", () => {
    expect(clean("<p>Some <strong>bold</strong> text</p>")).toBe("Some <strong>bold</strong> text");
  });

  it("treats an empty editor as empty, but keeps a new empty table", () => {
    expect(clean("<p><br></p>")).toBe("");
    expect(clean("<p></p>")).toBe("");
    expect(clean("<table><tbody><tr><td><br></td></tr></tbody></table>")).toBe(`<table class="cms-table"><tbody><tr><td></td></tr></tbody></table>`);
  });

  it("removes the <br> an editor leaves at the end of a block", () => {
    expect(clean("<p>hello<br></p>")).toBe("hello");
    expect(clean("<ul><li>a<br></li></ul>")).toBe("<ul><li>a</li></ul>");
    expect(clean("<p>one<br>two</p>")).toBe("one<br>two");
  });

  it("keeps anything the plain form can't hold", () => {
    for (const html of ["<p>a</p><p>b</p>", `<p style="text-align:center">a</p>`, `<p><span style="color:#C2410C">a</span></p>`, "<p><u>a</u></p>", "<ul><li>a</li></ul>"]) {
      expect(clean(html), html).toBe(html);
    }
  });

  it("gives the same answer when it runs twice", () => {
    for (const html of ["plain", "<p>a</p>", "<p>a</p><p>b</p>", `<table><tr><td>a</td></tr></table>`, `<p style="color:#C2410C">a</p>`, "<p>a<br><br></p><p>b</p>", "<p>a<br> <br></p>"]) {
      expect(clean(clean(html)), html).toBe(clean(html));
    }
  });

  it("can't use a plain start to smuggle rich tags", () => {
    expect(clean(`hello <span style="position:fixed">a</span><table><tr><td>b</td></tr></table>`)).not.toMatch(/position|<table/);
  });
});

describe("paragraph blocks", () => {
  it("render plain text in a <p>, as before", () => {
    expect(blockHtml({ type: "paragraph", html: "Hi <strong>you</strong>" }, doc)).toBe("<p>Hi <strong>you</strong></p>");
  });

  it("render rich content without an extra <p>, cleaned again", () => {
    expect(blockHtml({ type: "paragraph", html: `<p>a</p><ul onclick="x"><li>b</li></ul>` }, doc)).toBe("<p>a</p><ul><li>b</li></ul>");
  });

  it("are saved through the rich rules, with their own length limit", () => {
    const guide = (html: string) => ({ slug: "a", title: "A", summary: "S", areaSlug: "x", publishedDate: "2026-11-05", seo: { title: "", description: "", noindex: false }, blocks: [{ type: "paragraph", html }] });
    const save = (html: string) => validateGuide(guide(html), new Set(["x"]), doc);
    const ok = save(`<p style="text-align:center">a</p><p onclick="y">b</p>`);
    expect(ok.ok && ok.guide.blocks[0]).toEqual({ type: "paragraph", html: `<p style="text-align:center">a</p><p>b</p>` });
    expect(save("x".repeat(19_000)).ok).toBe(true);
    const long = save("x".repeat(20_001));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors["blocks.0"]).toMatch(/20000|20,000/);
  });
});
