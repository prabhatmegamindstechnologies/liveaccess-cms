// Editable fields of a real page (ported from the prototype, which was tested in a browser).
// Works on any DOM: the preview iframe's document in the admin, linkedom in tests and on the server.
// Editing changes only the text, links and images of existing elements; the page layout is never touched.
import { normalizeSpace, richStyle, sanitizeInline, sanitizeText } from "./sanitize.ts";

export type Field = {
  id: number;
  type: "text" | "node" | "img";
  el: Element;
  node?: Text;
  prefix: string;
  value: string;
  label: string;
  section: string;
  root: Element;
  item: Element | null;
  toc: Element | null;
};

// U and S come only from the text editor; the site's own pages have none.
const INLINE = new Set(["B", "STRONG", "EM", "I", "SPAN", "SMALL", "A", "BR", "TIME", "CODE", "U", "S"]);
const SKIP = ".site-header, .site-footer, .crumbs, script, style, svg, [aria-hidden=\"true\"], .visually-hidden, .toc, .skip-link, .store-badges, select, option, textarea, input, noscript, .drop";
const ITEM_TAGS = new Set(["LI", "TR", "DETAILS", "ARTICLE", "DIV", "A", "BUTTON"]);
const BLOCKISH = "svg, img, div, p, ul, ol, h1, h2, h3, h4";
export const FIELD_ATTR = "data-cms-f";

/* ---------- scripts are kept out of the editable DOM and put back on save ---------- */

const SCRIPT_RE = /<script\b[\s\S]*?<\/script\s*>/gi;
const MARKER_RE = /<!--cms-script:(\d+)-->/g;

/** Replaces every <script> with a comment marker, so the preview never runs page code. */
export function splitScripts(html: string): { html: string; scripts: string[] } {
  const scripts: string[] = [];
  const out = html.replace(SCRIPT_RE, (m) => `<!--cms-script:${scripts.push(m) - 1}-->`);
  return { html: out, scripts };
}

export function joinScripts(html: string, scripts: string[]): string {
  return html.replace(MARKER_RE, (_, i: string) => scripts[Number(i)] ?? "");
}

/* ---------- reading fields ---------- */

const isText = (n: Node): n is Text => n.nodeType === 3;
const hasOwnText = (el: Element) => Array.from(el.childNodes).some((n) => isText(n) && (n.textContent ?? "").trim() !== "");
const allInline = (kids: Element[]) => kids.every((k) => INLINE.has(k.tagName) && !k.querySelector(BLOCKISH));
/** The text editor's own marks: underline, strikethrough, or a style already in its stored form. The site's pages have none. */
const editorMark = (el: Element) => el.tagName === "U" || el.tagName === "S" || (el.hasAttribute("style") && richStyle(el.getAttribute("style")!, false) === el.getAttribute("style"));
/**
 * Text formatted from end to end (the whole heading coloured) has no text of its own, only the editor's formatting around it.
 * It stays one field on its element, so the field keeps its place and label after a reload.
 */
const formattedOnly = (el: Element, kids: Element[]) =>
  kids.length > 0 && !INLINE.has(el.tagName) && (el.textContent ?? "").trim() !== "" && allInline(kids) && Array.from(el.querySelectorAll("*")).some(editorMark);

export function buildFields(doc: Document): Field[] {
  const main = doc.querySelector("main");
  const fields: Field[] = [];
  if (!main) return fields;
  doc.querySelectorAll(`[${FIELD_ATTR}]`).forEach((e) => e.removeAttribute(FIELD_ATTR));

  const rootOf = (el: Element): Element => {
    const s = el.closest("section");
    if (s && main.contains(s)) return s;
    let a = el;
    while (a.parentElement && a.parentElement !== main) a = a.parentElement;
    return a;
  };
  const add = (f: Omit<Field, "id" | "root" | "item" | "section" | "label">) => {
    const root = rootOf(f.el);
    const field = { ...f, id: fields.length, root, item: itemOf(f.el, root), section: sectionTitle(root), label: "" } as Field;
    field.label = labelFor(field);
    f.el.setAttribute(FIELD_ATTR, String(field.id));
    fields.push(field);
  };

  const walk = (el: Element) => {
    if (el.matches(SKIP)) return;
    if (el.tagName === "IMG") {
      add({ type: "img", el, prefix: "", value: el.getAttribute("src") ?? "", toc: null });
      return;
    }
    const kids = Array.from(el.children);
    if (formattedOnly(el, kids)) {
      add(textField(el));
      return;
    }
    if (hasOwnText(el)) {
      if (allInline(kids)) {
        add(textField(el));
        return;
      }
      const node = Array.from(el.childNodes).find((n): n is Text => isText(n) && (n.textContent ?? "").trim() !== "")!;
      add({ type: "node", el, node, prefix: "", value: normalizeSpace(node.textContent ?? ""), toc: null });
      kids.forEach((k) => { if (!INLINE.has(k.tagName)) walk(k); });
      return;
    }
    kids.forEach(walk);
  };
  walk(main);
  return fields;
}

function textField(el: Element): Omit<Field, "id" | "root" | "item" | "section" | "label"> {
  const copy = el.cloneNode(true) as Element;
  let prefix = "";
  const first = copy.firstElementChild;
  const before = first?.previousSibling;
  if (first && first.tagName === "SPAN" && /\b(num|n)\b/.test(first.className) && !(before && isText(before) && (before.textContent ?? "").trim())) {
    prefix = first.outerHTML;
    first.remove();
  }
  const sec = el.closest("section.term");
  const toc = el.tagName === "H2" && sec?.id ? el.ownerDocument.querySelector(`.toc a[href="#${sec.id}"]`) : null;
  const clean = rich(el) ? sanitizeText : sanitizeInline;
  return { type: "text", el, prefix, value: normalizeSpace(clean(copy.innerHTML, el.ownerDocument)), toc };
}

// Short labels keep a plain box: formatting there would fight the site's own button, tag and number styles.
const PLAIN_LABELS = new Set(["Button text", "Link text", "Number", "Label", "Small label above heading", "Form label"]);
const rich = (el: Element) => !PLAIN_LABELS.has(labelFor({ type: "text", el } as Field));

/** True when a field is edited with the text editor (fonts, sizes, colours), false for a plain box. */
export const richField = (f: Field) => f.type === "text" && rich(f.el);

function itemOf(el: Element, root: Element): Element | null {
  let a: Element | null = el;
  while (a && a !== root && a.parentElement) {
    const p: Element = a.parentElement;
    if (ITEM_TAGS.has(a.tagName)) {
      const tag = a.tagName, cls = a.className;
      if (Array.from(p.children).filter((c) => c.tagName === tag && c.className === cls).length >= 2) return a;
    }
    if (p === root) break;
    a = p;
  }
  return null;
}

function sectionTitle(root: Element): string {
  const h = root.querySelector("h1, h2") ?? root.querySelector("h3, .eyebrow, .kicker");
  return h ? normalizeSpace(h.textContent ?? "").slice(0, 70) : "Section";
}

function labelFor(f: Field): string {
  const el = f.el, t = el.tagName, c = ` ${el.className} `;
  if (f.type === "img") return "Image";
  if (t === "H1") return "Main heading";
  if (t === "H2") return / h3 /.test(c) ? "Card title" : "Heading";
  if (t === "H3" || t === "H4") return "Sub-heading";
  if (t === "SUMMARY") return "Question";
  if (t === "P" && el.closest("details")) return "Answer";
  if (/ lede /.test(c)) return "Intro text";
  if (/ (eyebrow|kicker) /.test(c)) return "Small label above heading";
  if (/ (feat-note|tile-note|opt-tag|pill|tag) /.test(c)) return "Label";
  if (/ n /.test(c)) return "Number";
  if (t === "A" && / btn /.test(c)) return "Button text";
  if (t === "A") return "Link text";
  if (t === "LI") return "List item";
  if (t === "TD" || t === "TH") return "Table cell";
  if (t === "LABEL") return "Form label";
  if (t === "B" || t === "STRONG") return "Bold title";
  if (t === "P") return "Paragraph";
  return "Text";
}

/* ---------- writing ---------- */

export function writeField(f: Field, value: string) {
  const doc = f.el.ownerDocument;
  if (f.type === "img") {
    f.el.setAttribute("src", value);
    f.el.removeAttribute("srcset");
  } else if (f.type === "node" && f.node) {
    const raw = f.node.textContent ?? "";
    const lead = raw.match(/^\s*/)![0], trail = raw.match(/\s*$/)![0];
    f.node.textContent = lead + value.replace(/[<>]/g, "") + trail;
  } else {
    const clean = richField(f) ? sanitizeText(value, doc) : sanitizeInline(value, doc);
    f.el.innerHTML = (f.prefix ? f.prefix + " " : "") + clean;
    if (f.toc) {
      const box = doc.createElement("div");
      box.innerHTML = clean;
      f.toc.textContent = normalizeSpace(box.textContent ?? "");
    }
  }
  f.value = value;
}

export function setImageAlt(f: Field, alt: string) {
  if (f.type === "img") f.el.setAttribute("alt", alt);
}

/** Puts another picture in an image's place. The page chose the tag's width, so that stays; a height follows the new shape. */
export function setImageSrc(f: Field, src: string, alt: string, width: number | null, height: number | null) {
  writeField(f, src);
  setImageAlt(f, alt);
  const shown = Number(f.el.getAttribute("width"));
  if (shown && f.el.hasAttribute("height") && width && height) f.el.setAttribute("height", String(Math.round(shown * height / width)));
}

/* ---------- repeating items ---------- */

const sameKind = (a: Element | null | undefined, b: Element) => !!a && a.tagName === b.tagName && a.className === b.className;

export function moveItem(f: Field, dir: -1 | 1): boolean {
  const it = f.item;
  if (!it?.parentElement) return false;
  const other = dir < 0 ? it.previousElementSibling : it.nextElementSibling;
  if (!sameKind(other, it)) return false;
  if (dir < 0) it.parentElement.insertBefore(it, other);
  else it.parentElement.insertBefore(other!, it);
  return true;
}

export function removeItem(f: Field): boolean {
  const it = f.item;
  if (!it?.parentElement) return false;
  const count = Array.from(it.parentElement.children).filter((c) => sameKind(c, it)).length;
  if (count < 2) return false;
  it.remove();
  return true;
}

export function addItem(f: Field): Element | null {
  const it = f.item;
  if (!it) return null;
  const copy = it.cloneNode(true) as Element;
  copy.removeAttribute("open");
  copy.removeAttribute("id");
  copy.querySelectorAll(`[${FIELD_ATTR}]`).forEach((e) => e.removeAttribute(FIELD_ATTR));
  copy.removeAttribute(FIELD_ATTR);
  it.after(copy);
  const first = firstTextNode(copy);
  if (first) first.textContent = "New item";
  return copy;
}

function firstTextNode(el: Node): Text | null {
  for (const n of Array.from(el.childNodes)) {
    if (isText(n) && (n.textContent ?? "").trim()) {
      const parent = n.parentElement;
      if (parent && !parent.closest(".num, .n, svg")) return n;
    } else if (n.nodeType === 1) {
      const found = firstTextNode(n);
      if (found) return found;
    }
  }
  return null;
}

/* ---------- saving ---------- */

/** Full page HTML: editor-only marks and preview styles removed, original scripts restored. */
export function serialize(doc: Document, scripts: string[]): string {
  const root = doc.documentElement.cloneNode(true) as Element;
  root.querySelectorAll("[data-cms-f], [data-cms-hl], [data-cms-b], [data-cms-x]").forEach((e) => {
    for (const a of ["data-cms-f", "data-cms-hl", "data-cms-b", "data-cms-x"]) e.removeAttribute(a);
  });
  root.querySelectorAll("#cms-preview, base[data-cms]").forEach((e) => e.remove());
  return joinScripts("<!DOCTYPE html>\n" + root.outerHTML, scripts);
}
