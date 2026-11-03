import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { sanitizeInline } from "../src/sanitize.ts";

const { document } = parseHTML("<!doctype html><html><body></body></html>");
const clean = (html: string) => sanitizeInline(html, document);

describe("sanitizeInline", () => {
  it("keeps the allowed inline tags", () => {
    expect(clean('Built by <em>TPS</em> and <strong>you</strong><br><a href="contact.html">Contact</a>'))
      .toBe('Built by <em>TPS</em> and <strong>you</strong><br><a href="contact.html">Contact</a>');
  });

  it("keeps the class on spans and links so existing styles still apply", () => {
    expect(clean('<span class="num">1.</span> <a class="link-arrow" href="get-app.html">Ask</a>'))
      .toBe('<span class="num">1.</span> <a href="get-app.html" class="link-arrow">Ask</a>');
  });

  it("drops a rel attribute when there is no target", () => {
    expect(clean('<a href="contact.html" rel="nofollow">x</a>')).toBe('<a href="contact.html">x</a>');
  });

  it("drops scripts and their content", () => {
    expect(clean('Hi<script>alert(1)</script><style>p{}</style>')).toBe("Hi");
  });

  it("unwraps layout tags but keeps their text", () => {
    expect(clean("<div><p>Text</p></div>")).toBe("Text");
  });

  it("removes event handlers and unknown attributes", () => {
    expect(clean('<em onclick="x()" style="color:red">a</em>')).toBe("<em>a</em>");
  });

  it("removes javascript: links", () => {
    expect(clean('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("removes protocol-relative links to other sites", () => {
    expect(clean('<a href="//evil.com">x</a>')).toBe("<a>x</a>");
    expect(clean('<a href="/\\evil.com">x</a>')).toBe("<a>x</a>");
    expect(clean('<a href="/contact.html">x</a>')).toBe('<a href="/contact.html">x</a>');
    expect(clean('<a href="privacy-policy.html#ai">x</a>')).toBe('<a href="privacy-policy.html#ai">x</a>');
  });

  it("only allows target=_blank and then always adds rel=noopener noreferrer", () => {
    expect(clean('<a href="https://tps.ltd/" target="_blank" rel="opener">TPS</a>')).toBe('<a href="https://tps.ltd/" target="_blank" rel="noopener noreferrer">TPS</a>');
    expect(clean('<a href="https://tps.ltd/" target="evil">TPS</a>')).toBe('<a href="https://tps.ltd/">TPS</a>');
  });

  it("survives very deep nesting without crashing", () => {
    const deep = "<span>".repeat(5000) + "x" + "</span>".repeat(5000);
    expect(() => clean(deep)).not.toThrow();
  });

  it("escapes angle brackets in text but leaves apostrophes alone", () => {
    expect(clean("Can't &lt;b&gt;")).toBe("Can't &lt;b&gt;");
  });
});

describe("sanitizeInline on hostile input", () => {
  it("stays fast on many unclosed tags (no quadratic regex)", async () => {
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML("<!doctype html><html><body></body></html>");
    const evil = "<a ".repeat(20_000);
    const t = performance.now();
    sanitizeInline(evil, document as unknown as Document);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
