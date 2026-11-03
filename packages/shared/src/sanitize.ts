// Inline-only HTML allow-list used for every editable text field (layout lock).
// Works with any DOM: the browser's `document`, or linkedom's in Node.

const INLINE = new Set(["B", "STRONG", "EM", "I", "SPAN", "SMALL", "A", "BR", "TIME", "CODE"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "SVG"]);
// Site-relative paths, anchors, page files, http(s) and mailto. "//host" and "/\host" (protocol-relative) are refused.
const SAFE_HREF = /^(https?:|mailto:|\/(?![\/\\])|#|\.\/|[a-z0-9-]+\.html(?:[#?]|$))/i;
const MAX_DEPTH = 50;

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const VOID = new Set(["br", "img", "hr", "input", "meta", "link", "wbr", "source", "area", "col", "embed", "track", "param", "base"]);

/** Rough nesting depth from the raw string, checked before parsing (some DOM parsers overflow on hostile nesting). */
function tagDepth(html: string): number {
  let depth = 0, max = 0;
  // [^<>] (not [^>]) so an unclosed tag stops at the next "<": linear time on hostile input.
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^<>]*?(\/?)>/g)) {
    if (m[1]) depth = Math.max(0, depth - 1);
    else if (!m[3] && !VOID.has(m[2]!.toLowerCase())) max = Math.max(max, ++depth);
  }
  return max;
}

export function sanitizeInline(html: string, doc: Document): string {
  if (tagDepth(html) > 200) return escText(html.replace(/<[^<>]*>/g, ""));
  const box = doc.createElement("div");
  box.innerHTML = html;
  return walk(box, 0);
}

function walk(node: Node, depth: number): string {
  // Deeper nesting keeps its text but loses its tags, so hostile input can't overflow the stack.
  if (depth > MAX_DEPTH) return escText(node.textContent ?? "");
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      out += escText(n.textContent ?? "");
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) return;
    if (!INLINE.has(tag)) {
      out += walk(el, depth + 1);
      return;
    }
    if (tag === "BR") {
      out += "<br>";
      return;
    }
    let attrs = "";
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      if (SAFE_HREF.test(href)) attrs += ` href="${escAttr(href)}"`;
      const cls = el.getAttribute("class");
      if (cls) attrs += ` class="${escAttr(cls)}"`;
      if (el.getAttribute("target") === "_blank") attrs += ` target="_blank" rel="noopener noreferrer"`;
    }
    if ((tag === "SPAN" || tag === "SMALL") && el.getAttribute("class")) attrs += ` class="${escAttr(el.getAttribute("class")!)}"`;
    if (tag === "TIME" && el.getAttribute("datetime")) attrs += ` datetime="${escAttr(el.getAttribute("datetime")!)}"`;
    const t = tag.toLowerCase();
    out += `<${t}${attrs}>${walk(el, depth + 1)}</${t}>`;
  });
  return out;
}

export const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();
