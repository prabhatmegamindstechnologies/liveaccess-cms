// Guide and process-area blocks: read from the current article markup, and render back to the same markup.
import { normalizeSpace, sanitizeInline } from "./sanitize.ts";

export type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; html: string }
  | { type: "list"; style: "bullet" | "number"; items: string[] }
  | { type: "callout"; variant: "safety" | "disclaimer"; title: string; text: string }
  | { type: "image"; mediaId: number | null; position: "left" | "right" | "center" | "full"; alt: string; caption: string }
  | { type: "table"; rows: string[][] }
  | { type: "quote"; text: string; cite: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function importBlocks(article: Element): Block[] {
  const doc = article.ownerDocument;
  const inline = (el: Element) => normalizeSpace(sanitizeInline(el.innerHTML, doc));
  const out: Block[] = [];
  for (const n of Array.from(article.children)) {
    const tag = n.tagName.toUpperCase();
    if (n.classList.contains("note-safety")) {
      const strong = n.querySelector("strong");
      const title = strong ? normalizeSpace(strong.textContent ?? "") : "";
      const copy = n.cloneNode(true) as Element;
      copy.querySelector("strong")?.remove();
      out.push({ type: "callout", variant: "safety", title, text: inline(copy) });
    } else if (tag === "H2" || tag === "H3") {
      out.push({ type: "heading", level: tag === "H3" ? 3 : 2, text: normalizeSpace(n.textContent ?? "") });
    } else if (tag === "UL" || tag === "OL") {
      out.push({ type: "list", style: tag === "OL" ? "number" : "bullet", items: Array.from(n.children).map(inline) });
    } else if (n.classList.contains("article-note")) {
      out.push({ type: "callout", variant: "disclaimer", title: "", text: inline(n) });
    } else if (tag === "P") {
      out.push({ type: "paragraph", html: inline(n) });
    }
  }
  return out;
}

/** Renders one block with the site's existing classes. `mediaSrc` resolves image blocks (Day 3). */
export function blockHtml(b: Block, doc: Document, mediaSrc: (id: number) => string | null = () => null): string {
  const inline = (s: string) => sanitizeInline(s, doc);
  switch (b.type) {
    case "heading":
      return b.level === 3 ? `<h3>${esc(b.text)}</h3>` : `<h2>${esc(b.text)}</h2>`;
    case "paragraph":
      return `<p>${inline(b.html)}</p>`;
    case "list": {
      const t = b.style === "number" ? "ol" : "ul";
      return `<${t}>${b.items.filter((x) => x.trim()).map((x) => `<li>${inline(x)}</li>`).join("")}</${t}>`;
    }
    case "callout":
      return b.variant === "disclaimer"
        ? `<p class="article-note">${inline(b.text)}</p>`
        : `<div class="note note-safety" role="note"><strong>${esc(b.title)}</strong> ${inline(b.text)}</div>`;
    case "quote":
      return `<blockquote class="cms-quote">${esc(b.text)}${b.cite ? `<cite>${esc(b.cite)}</cite>` : ""}</blockquote>`;
    case "table": {
      const rows = b.rows.filter((r) => r.join("").trim());
      if (!rows.length) return "";
      const [head, ...body] = rows;
      return `<table class="cms-table"><thead><tr>${head!.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    case "image": {
      const src = b.mediaId == null ? null : mediaSrc(b.mediaId);
      if (!src) return "";
      return `<figure class="cms-img cms-img-${b.position}"><img src="${esc(src)}" alt="${esc(b.alt)}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
  }
}
