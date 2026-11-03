// Server-side check of page HTML before it is saved (layout lock + security; the admin UI is not trusted).
// Allow-list: an editor only changes text, links and images of elements that already exist, and copies existing
// repeating items. So the new page may only use element types, attributes and inline styles that the published
// page already has, and its scripts must be exactly the published scripts in the same places.
import { parseHTML } from "linkedom";
import { splitScripts } from "@liveaccess/shared";

export const MAX_PAGE_BYTES = 1_000_000;

// Head elements an editor may change (through the SEO tab or the page HTML).
const EDITABLE_HEAD = 'title, meta[name="description"], meta[name="robots"], link[rel="canonical"]';
// Inline tags the field sanitizer can produce, and the attributes it can produce.
const INLINE_TAGS = new Set(["em", "strong", "b", "i", "span", "small", "a", "br", "time", "code"]);
const INLINE_ATTRS = new Set(["href", "class", "target", "rel", "datetime"]);
// Never allowed, whatever the published page has.
const FORBIDDEN_ATTR = /^(on|srcdoc$|formaction$|xmlns:|xlink:)/i;
const URL_ATTRS = new Set(["href", "src", "srcset", "action", "data", "poster", "cite", "background"]);
const SAFE_SCHEME = /^(https?:|mailto:|tel:)$/i;

type Shape = { tags: Set<string>; attrs: Set<string>; styles: Set<string>; scripts: string[]; head: string[] };

function shape(document: Document): Shape {
  const body = document.body;
  const tags = new Set<string>(), attrs = new Set<string>(), styles = new Set<string>();
  for (const el of Array.from(body.querySelectorAll("*"))) {
    tags.add(el.localName.toLowerCase());
    for (const a of Array.from(el.attributes)) {
      attrs.add(a.name.toLowerCase());
      if (a.name.toLowerCase() === "style") styles.add(a.value);
    }
  }
  // Every script element (HTML or SVG), with its position in the tree, so scripts can't be moved or wrapped.
  const scripts = Array.from(document.querySelectorAll("script")).map((s) => `${path(s)}|${s.outerHTML}`);
  const head = Array.from(document.head.children).filter((el) => !el.matches(EDITABLE_HEAD)).map((el) => el.outerHTML);
  return { tags, attrs, styles, scripts, head };
}

function path(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el.parentElement; e; e = e.parentElement) parts.unshift(e.localName);
  return parts.join(">");
}

function urlProblem(name: string, value: string): string | null {
  const parts = name === "srcset" ? value.split(",").map((p) => p.trim().split(/\s+/)[0] ?? "") : [value];
  for (const raw of parts) {
    const v = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
    if (/^[\\/]{2}/.test(v)) return "Links to other sites must start with https://.";
    const scheme = v.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1];
    if (scheme && !SAFE_SCHEME.test(scheme)) return scheme.toLowerCase() === "javascript:" ? "javascript: links are not allowed." : `${scheme} links are not allowed.`;
  }
  return null;
}

/** Returns a plain error message, or null if the HTML may be saved. `reference` is the published HTML. */
export function checkPageHtml(html: string, reference: string): string | null {
  if (Buffer.byteLength(html, "utf8") > MAX_PAGE_BYTES) return "The page is too large to save.";
  if (!/^\s*<!doctype html>/i.test(html)) return "The page HTML is incomplete.";
  if (html.includes("cms-script:")) return "The page contains editor-only markers and can't be saved.";

  const { document } = parseHTML(html);
  const { document: refDoc } = parseHTML(reference);
  const next = shape(document), ref = shape(refDoc);

  // Scripts: same elements, same places (DOM-based) — and the raw text agrees (catches parser tricks).
  const rawNext = splitScripts(html).scripts, rawRef = splitScripts(reference).scripts;
  if (next.scripts.length !== ref.scripts.length || next.scripts.some((s, i) => s !== ref.scripts[i]) ||
      rawNext.length !== rawRef.length || rawNext.some((s, i) => s !== rawRef[i])) {
    return "Scripts can't be added, removed, moved or changed in the admin panel (this keeps Google Analytics and the cookie banner intact).";
  }

  if (next.head.length !== ref.head.length || next.head.some((x, i) => x !== ref.head[i])) {
    return "Only the title, description, canonical and robots tags in the page head can be changed.";
  }

  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    if (!ref.tags.has(tag) && !INLINE_TAGS.has(tag)) return `The element <${tag}> can't be added to this page.`;
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (FORBIDDEN_ATTR.test(name)) return name.startsWith("on") ? "Event attributes (like onclick) are not allowed." : `The attribute ${name} is not allowed.`;
      if (!ref.attrs.has(name) && !INLINE_ATTRS.has(name)) return `The attribute ${name} can't be added to this page.`;
      if (name === "style" && !ref.styles.has(a.value)) return "Inline styles can't be changed in the admin panel.";
      if (URL_ATTRS.has(name)) {
        const problem = urlProblem(name, a.value);
        if (problem) return problem;
      }
    }
  }
  return null;
}
