import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { addItem, buildFields, moveItem, removeItem, serialize, splitScripts, writeField, type Field } from "../src/fields.ts";

const siteRoot = join(import.meta.dirname, "..", "..", "..");
function load(file: string) {
  const raw = readFileSync(join(siteRoot, file), "utf8");
  const { html, scripts } = splitScripts(raw);
  const { document } = parseHTML(html);
  return { raw, scripts, document, fields: buildFields(document) };
}
const find = (fields: Field[], pred: (f: Field) => boolean) => {
  const f = fields.find(pred);
  if (!f) throw new Error("field not found");
  return f;
};

describe("splitScripts", () => {
  it("takes every script out and puts them back byte-for-byte", () => {
    const raw = readFileSync(join(siteRoot, "about.html"), "utf8");
    const { html, scripts } = splitScripts(raw);
    expect(html).not.toMatch(/<script/i);
    expect(scripts.length).toBeGreaterThan(3);
    expect(scripts.join("")).toContain("G-JFHJD3T51M");
  });
});

describe("buildFields on about.html", () => {
  const { fields } = load("about.html");

  it("finds the main heading with its highlight kept as <em>", () => {
    const h1 = find(fields, (f) => f.label === "Main heading");
    expect(h1.value).toBe("Built by the people behind <em>your process lines.</em>");
  });

  it("skips the header, footer and breadcrumbs", () => {
    const texts = fields.map((f) => f.value).join(" | ");
    expect(texts).not.toContain("Cookie settings");
    expect(texts).not.toContain("Skip to content");
    expect(fields.some((f) => f.el.closest(".crumbs"))).toBe(false);
  });

  it("groups the two fact boxes as repeating items", () => {
    const items = new Set(fields.filter((f) => f.item?.classList.contains("fact")).map((f) => f.item));
    expect(items.size).toBe(2);
  });
});

describe("writeField", () => {
  it("changes only that element and keeps allowed formatting", () => {
    const { document, fields } = load("about.html");
    const h1 = find(fields, (f) => f.label === "Main heading");
    writeField(h1, 'Built by <em>TPS engineers.</em><script>x</script>');
    expect(document.querySelector("h1")!.innerHTML).toBe("Built by <em>TPS engineers.</em>");
    expect(document.querySelector(".story .lede")!.textContent).toMatch(/^LiveAccess is made by TPS/);
  });

  it("keeps the section number on legal headings and updates the table of contents", () => {
    const { document, fields } = load("privacy-policy.html");
    const h = find(fields, (f) => f.el.tagName === "H2" && f.el.closest("section.term")?.id === "information");
    expect(h.value).toBe("Information We Collect");
    writeField(h, "What We Collect");
    expect(document.querySelector("#information h2")!.innerHTML).toBe('<span class="num">1.</span> What We Collect');
    expect(document.querySelector('.toc a[href="#information"]')!.textContent).toBe("What We Collect");
  });
});

describe("repeating items", () => {
  it("adds a copy of a fact box", () => {
    const { document, fields } = load("about.html");
    const fact = find(fields, (f) => !!f.item?.classList.contains("fact"));
    addItem(fact);
    expect(document.querySelectorAll(".fact")).toHaveLength(3);
  });

  it("moves and removes comparison table rows on How it works", () => {
    const { document, fields } = load("how-it-works.html");
    const rows = () => Array.from(document.querySelectorAll(".compare tbody tr")).map((r) => r.querySelector("td")!.textContent);
    const first = find(fields, (f) => f.item?.tagName === "TR" && f.value === "Finding the page");
    moveItem(first, 1);
    expect(rows().slice(0, 2)).toEqual(["At the machine", "Finding the page"]);
    expect(removeItem(first)).toBe(true);
    expect(rows()).toHaveLength(4);
  });

  it("won't remove the last item of a list", () => {
    const { fields } = load("guides.html");
    const anyCard = find(fields, (f) => !!f.item?.classList.contains("feat"));
    const siblings = Array.from(anyCard.item!.parentElement!.children);
    for (const s of siblings.slice(1)) s.remove();
    expect(removeItem(anyCard)).toBe(false);
  });

  it("finds FAQ questions and answers", () => {
    const { fields } = load("faq.html");
    expect(fields.some((f) => f.label === "Question" && f.value === "What is LiveAccess?")).toBe(true);
    expect(fields.some((f) => f.label === "Answer")).toBe(true);
  });
});

describe("serialize", () => {
  it("removes editor-only marks and restores the original scripts", () => {
    const { raw, scripts, document, fields } = load("about.html");
    document.head.insertAdjacentHTML("beforeend", '<style id="cms-preview">x{}</style>');
    fields[0]!.el.setAttribute("data-cms-hl", "");
    const out = serialize(document, scripts);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).not.toMatch(/data-cms-|cms-preview|cms-script/);
    for (const s of scripts) expect(out).toContain(s);
    expect(out.match(/<script/g)!.length).toBe(raw.match(/<script/g)!.length);
  });
});
