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
  const open = new Map<string, number>();
  let depth = 0, max = 0;
  // The name has to end at a space, "/" or ">", so an unclosed tag stops at once: linear time on hostile input.
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][^\s/<>]*)(?=[\s/>])[^<>]*>/g)) {
    const name = m[2]!.toLowerCase();
    if (VOID.has(name)) continue;
    const count = open.get(name) ?? 0;
    // Parsers nest <b/> like <b>, and ignore a closing tag with nothing to close, so neither may lower the count.
    if (!m[1]) {
      open.set(name, count + 1);
      max = Math.max(max, ++depth);
    } else if (count) {
      open.set(name, count - 1);
      depth--;
    }
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

/* ---------- rich paragraphs (guides and process areas only) ---------- */

// The editor's set fonts and sizes. A value that isn't listed here never reaches the database or the site. Colours are free,
// but only a strict solid colour gets through, always rewritten as #RRGGBB.
export const RICH_FONTS: Record<string, string> = {
  "Plus Jakarta Sans": "'Plus Jakarta Sans',sans-serif", "IBM Plex Mono": "'IBM Plex Mono',monospace", Arial: "Arial,Helvetica,sans-serif",
  "Courier New": "'Courier New',Courier,monospace", Georgia: "Georgia,serif", "Lucida Sans Unicode": "'Lucida Sans Unicode','Lucida Grande',sans-serif",
  Tahoma: "Tahoma,Geneva,sans-serif", "Times New Roman": "'Times New Roman',Times,serif", "Trebuchet MS": "'Trebuchet MS',Helvetica,sans-serif",
  Helvetica: "Helvetica,sans-serif", Impact: "Impact,Charcoal,sans-serif", Verdana: "Verdana,Geneva,sans-serif"
};
export const RICH_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 32, 34, 36, 48, 60, 72, 96];

const RICH_INLINE = new Set([...INLINE, "U", "S"]);
const RICH_BLOCK = new Set(["P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
const STYLED = new Set(["P", "LI", "TD", "TH", "SPAN", "STRONG", "B", "EM", "I", "U", "S"]);

function hexColour(value: string): string | null {
  const v = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("").toUpperCase()}`;
  const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v);
  if (!m || m.slice(1).some((n) => Number(n) > 255)) return null;
  return `#${m.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Each property is read on its own and rewritten from the lists above, so nothing from the input is copied through. */
function richStyle(style: string): string {
  const out = new Map<string, string>();
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase(), value = part.slice(i + 1).trim();
    if (prop === "color" || prop === "background-color") {
      const c = hexColour(value);
      if (c) out.set(prop, c);
    } else if (prop === "font-size") {
      const px = /^(\d{1,3})px$/.exec(value);
      if (px && RICH_SIZES.includes(Number(px[1]))) out.set(prop, `${Number(px[1])}px`);
    } else if (prop === "font-family") {
      const name = (value.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
      if (Object.hasOwn(RICH_FONTS, name)) out.set(prop, RICH_FONTS[name]!);
    } else if (prop === "text-align" && (value === "left" || value === "center" || value === "right")) {
      out.set(prop, value);
    }
  }
  return [...out].map(([k, v]) => `${k}:${v}`).join(";");
}

function walkRich(node: Node, depth: number, inCell: boolean): string {
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
    if (DROP.has(tag) || tag === "MATH") return;
    if (tag === "BR") {
      out += "<br>";
      return;
    }
    const cell = inCell || tag === "TD" || tag === "TH";
    // Table cells hold inline text only, so blocks and tables inside a cell lose their tags and keep their text.
    if (!RICH_INLINE.has(tag) && (!RICH_BLOCK.has(tag) || inCell)) {
      out += walkRich(el, depth + 1, cell);
      return;
    }
    let attrs = "";
    if (tag === "TABLE") attrs += ` class="cms-table"`;
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      if (SAFE_HREF.test(href)) attrs += ` href="${escAttr(href)}"`;
      if (el.getAttribute("target") === "_blank") attrs += ` target="_blank" rel="noopener noreferrer"`;
    }
    if (tag === "TIME" && el.getAttribute("datetime")) attrs += ` datetime="${escAttr(el.getAttribute("datetime")!)}"`;
    if (STYLED.has(tag)) {
      const style = richStyle(el.getAttribute("style") ?? "");
      if (style) attrs += ` style="${escAttr(style)}"`;
    }
    // A span with nothing left to say is only noise.
    if (tag === "SPAN" && !attrs) {
      out += walkRich(el, depth + 1, cell);
      return;
    }
    const t = tag.toLowerCase();
    const inner = walkRich(el, depth + 1, cell);
    if (tag !== "SPAN" || inner) out += `<${t}${attrs}>${inner}</${t}>`;
  });
  return out;
}

/** The allow-list for rich paragraphs. Wider than `sanitizeInline`, and used for nothing else. */
export function sanitizeRich(html: string, doc: Document): string {
  if (tagDepth(html) > 200) return escText(html.replace(/<[^<>]*>/g, ""));
  const box = doc.createElement("div");
  box.innerHTML = html;
  return walkRich(box, 0, false);
}

/** A paragraph is rich if it starts with a block tag; anything else is the plain inline text every paragraph used to be. */
export const isRichParagraph = (html: string) => /^\s*<(?:p|ul|ol|table)[\s>]/i.test(html);

/**
 * The stored form of a paragraph. A single plain paragraph stays as bare inline text, so existing guides keep their stored
 * value and their published pages. Running this twice gives the same result.
 */
export function cleanParagraph(html: string, doc: Document): string {
  if (!isRichParagraph(html)) return normalizeSpace(sanitizeInline(html, doc));
  // Editors leave a <br> at the end of a block to hold the caret. It shows nothing, and would stop a plain paragraph staying plain.
  const rich = normalizeSpace(sanitizeRich(html, doc)).replace(/(?:\s*<br>)+\s*(?=<\/(?:p|li|td|th)>)/g, "");
  const box = doc.createElement("div");
  box.innerHTML = rich;
  if (!(box.textContent ?? "").trim() && !rich.includes("<table")) return "";
  const inner = /^<p>((?:(?!<\/?p[\s>]).)*)<\/p>$/.exec(rich)?.[1];
  return inner !== undefined && sanitizeInline(inner, doc) === inner ? inner : rich;
}
