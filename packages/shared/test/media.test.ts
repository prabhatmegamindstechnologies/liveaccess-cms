import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { articleBody, blockHtml, cleanParagraph, isMediaSrc, MEDIA_DIR, mediaKeysIn, sanitizeRich, setImageSrc, validateGuide, type Block, type Field } from "../src/index.ts";

const doc = parseHTML("<!doctype html><html><body></body></html>").document as unknown as Document;
const key = "0123456789abcdef0123456789abcdef.webp";
const src = `${MEDIA_DIR}${key}`;

describe("media addresses", () => {
  it("accepts only the exact form", () => {
    expect(isMediaSrc(src)).toBe(true);
    for (const bad of ["https://evil.example/a.webp", "data:image/webp;base64,AAAA", `../${src}`, `/${src}`, `${src}?x=1`, "images/cms/abc.webp", `${MEDIA_DIR}0123456789ABCDEF0123456789ABCDEF.webp`, `${src}\n`]) {
      expect(isMediaSrc(bad), bad).toBe(false);
    }
  });

  it("finds each key once in any text", () => {
    const other = "fedcba9876543210fedcba9876543210.webp";
    expect(mediaKeysIn(`<img src="${src}"><img src="${MEDIA_DIR}${other}"> ${src} images/other.webp`).sort()).toEqual([other, key].sort());
    expect(mediaKeysIn("no images")).toEqual([]);
  });
});

describe("images in rich paragraphs", () => {
  it("keeps a library image with its alt text", () => {
    expect(sanitizeRich(`<p>Before <img src="${src}" alt="A &quot;pump&quot;"> after</p>`, doc)).toBe(`<p>Before <img src="${src}" alt="A &quot;pump&quot;"> after</p>`);
  });

  it("removes every other image, and everything else on the tag", () => {
    for (const bad of ['<img src="https://evil.example/x.webp" alt="x">', '<img src="data:image/png;base64,AAAA">', `<img src="../${src}">`, '<img src="x" onerror="alert(1)">']) {
      expect(sanitizeRich(`<p>Text${bad}</p>`, doc), bad).toBe("<p>Text</p>");
    }
    expect(sanitizeRich(`<p><img src="${src}" alt="a" onerror="alert(1)" style="width:1px" class="x" width="9"></p>`, doc)).toBe(`<p><img src="${src}" alt="a"></p>`);
  });

  it("keeps a paragraph that holds only an image", () => {
    const html = `<p><img src="${src}" alt="a"></p>`;
    expect(cleanParagraph(html, doc)).toBe(html);
    expect(cleanParagraph(cleanParagraph(html, doc), doc)).toBe(html);
  });

  it("still empties a paragraph that has nothing left to show", () => {
    expect(cleanParagraph('<p><img src="https://evil.example/x.webp"></p>', doc)).toBe("");
  });

  it("leaves plain paragraphs as they were", () => {
    expect(cleanParagraph("Plain <strong>text</strong>", doc)).toBe("Plain <strong>text</strong>");
    expect(cleanParagraph("<p>Plain text</p>", doc)).toBe("Plain text");
  });

  it("never lets an image through the inline fields", () => {
    expect(cleanParagraph(`Text <img src="${src}" alt="a">`, doc)).toBe("Text");
  });
});

describe("image blocks", () => {
  const block: Block = { type: "image", mediaId: 7, position: "right", alt: 'A "pump"', caption: "Seal <detail>" };
  const resolve = (id: number) => (id === 7 ? src : null);

  it("renders with the site's classes, escaping alt text and caption", () => {
    expect(blockHtml(block, doc, resolve)).toBe(`<figure class="cms-img cms-img-right"><img src="${src}" alt="A &quot;pump&quot;"><figcaption>Seal &lt;detail&gt;</figcaption></figure>`);
  });

  it("reaches the image through the article body", () => {
    expect(articleBody([block], doc, "  ", "guide", resolve)).toContain(`<img src="${src}"`);
  });

  it("shows nothing for a missing picture", () => {
    expect(blockHtml({ ...block, mediaId: null }, doc, resolve)).toBe("");
    expect(blockHtml({ ...block, mediaId: 8 }, doc, resolve)).toBe("");
    expect(articleBody([block], doc, "  ")).toBe("");
  });
});

describe("validateGuide with image blocks", () => {
  const guide = (block: unknown) => ({ slug: "a-guide", title: "T", summary: "S", areaSlug: "x", publishedDate: "2026-11-06", blocks: [block], seo: {} });
  const check = (block: unknown, partial: boolean) => validateGuide(guide(block), new Set(["x"]), doc, { partial });

  it("lets a draft keep an unfinished image block", () => {
    const r = check({ type: "image", mediaId: null, position: "center", alt: "", caption: "" }, true);
    expect(r.ok).toBe(true);
  });

  it("needs a picture and alt text for Publish", () => {
    const none = check({ type: "image", mediaId: null, position: "center", alt: "A pump", caption: "" }, false);
    expect(none.ok ? "" : none.errors["blocks.0"]).toMatch(/image/i);
    const noAlt = check({ type: "image", mediaId: 3, position: "center", alt: " ", caption: "" }, false);
    expect(noAlt.ok ? "" : noAlt.errors["blocks.0"]).toMatch(/alt/i);
  });

  it("keeps a complete block", () => {
    const r = check({ type: "image", mediaId: 3, position: "left", alt: "  A pump ", caption: "Seal" }, false);
    expect(r.ok && r.guide.blocks[0]).toEqual({ type: "image", mediaId: 3, position: "left", alt: "A pump", caption: "Seal" });
  });

  it("cleans what it can't trust", () => {
    const r = check({ type: "image", mediaId: "3; drop", position: "<x>", alt: "a", caption: "", extra: "kept?" }, true);
    expect(r.ok && r.guide.blocks[0]).toEqual({ type: "image", mediaId: null, position: "center", alt: "a", caption: "" });
  });

  it("limits the text and refuses hidden characters", () => {
    expect(check({ type: "image", mediaId: 3, position: "left", alt: "x".repeat(301), caption: "" }, true).ok).toBe(false);
    expect(check({ type: "image", mediaId: 3, position: "left", alt: "a", caption: "x".repeat(301) }, true).ok).toBe(false);
    expect(check({ type: "image", mediaId: 3, position: "left", alt: "a‮b", caption: "" }, true).ok).toBe(false);
  });
});

describe("setImageSrc", () => {
  const field = (attrs: string) => {
    const { document } = parseHTML(`<!doctype html><html><body><img src="old.png" alt="old" ${attrs}></body></html>`);
    return { type: "img", el: document.querySelector("img"), value: "old.png" } as unknown as Field;
  };

  it("changes the picture and the alt text", () => {
    const f = field("");
    setImageSrc(f, src, "A pump", 800, 600);
    expect(f.el.getAttribute("src")).toBe(src);
    expect(f.el.getAttribute("alt")).toBe("A pump");
    expect(f.value).toBe(src);
    expect(f.el.hasAttribute("width")).toBe(false);
  });

  it("keeps the width the page gave the tag, and follows the new shape", () => {
    const f = field('width="100" height="50"');
    setImageSrc(f, src, "A pump", 800, 600);
    expect(f.el.getAttribute("width")).toBe("100");
    expect(f.el.getAttribute("height")).toBe("75");
  });

  it("leaves a tag with only one size alone", () => {
    const f = field('width="100"');
    setImageSrc(f, src, "A pump", 800, 600);
    expect(f.el.getAttribute("width")).toBe("100");
    expect(f.el.hasAttribute("height")).toBe(false);
  });
});
