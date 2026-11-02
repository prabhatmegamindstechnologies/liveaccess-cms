import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { blockHtml, importBlocks } from "../src/blocks.ts";

const html = `<!doctype html><html><body><article class="article">
  <div class="note note-safety" role="note"><strong>Safety first.</strong> Isolate the plant.</div>
  <h2>Symptoms</h2>
  <ul><li>Solids <strong>falling</strong>.</li><li>Steam rising.</li></ul>
  <ol><li>Check feed.</li></ol>
  <p>Call a TPS engineer.</p>
  <p class="article-note">General checks only.</p>
</article></body></html>`;

describe("importBlocks", () => {
  const { document } = parseHTML(html);
  const blocks = importBlocks(document.querySelector("article.article")!);

  it("turns each article child into a block of the right type", () => {
    expect(blocks.map((b) => b.type)).toEqual(["callout", "heading", "list", "list", "paragraph", "callout"]);
  });

  it("reads the safety note title and text", () => {
    expect(blocks[0]).toMatchObject({ type: "callout", variant: "safety", title: "Safety first.", text: "Isolate the plant." });
  });

  it("keeps bold text inside list items and marks numbered lists", () => {
    expect(blocks[2]).toMatchObject({ type: "list", style: "bullet", items: ["Solids <strong>falling</strong>.", "Steam rising."] });
    expect(blocks[3]).toMatchObject({ type: "list", style: "number" });
  });

  it("treats the article note as a disclaimer", () => {
    expect(blocks[5]).toMatchObject({ type: "callout", variant: "disclaimer", text: "General checks only." });
  });

  it("renders blocks back to the site's existing markup", () => {
    expect(blockHtml(blocks[0]!, document)).toBe('<div class="note note-safety" role="note"><strong>Safety first.</strong> Isolate the plant.</div>');
    expect(blockHtml(blocks[1]!, document)).toBe("<h2>Symptoms</h2>");
    expect(blockHtml(blocks[5]!, document)).toBe('<p class="article-note">General checks only.</p>');
  });
});
