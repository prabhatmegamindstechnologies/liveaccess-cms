// Header and footer menus of the site. Every page carries the same header and footer markup, so menus are read
// from and written into those exact blocks as text: the rest of the page is left byte-for-byte as it was.
// Works the same in the browser, on the server and in tests (no DOM needed).
import { safeHttpsUrl } from "./links.ts";

export type MenuLink = { label: string; href: string };
export type Menus = {
  header: { links: MenuLink[]; button: MenuLink };
  footer: { heading: string; links: MenuLink[] }[];
};

export const MENU_LIMITS = { header: 6, column: 8, label: 30, href: 300 } as const;

// All patterns run only inside the header or footer block, and may not cross a closing tag of what they match.
const NAV_RE = /(<nav class="nav-links"[^>]*>)((?:(?!<\/nav>)[\s\S])*?)(\n([ \t]*)<\/nav>)/;
const CTA_RE = /(<a class="nav-cta" href=")([^"]*)("[^>]*>(?:(?!<\/a>)[\s\S])*?<\/svg>\s*)([^<]*?)(\s*<\/a>)/;
const COL_RE = /<nav aria-label="([^"]*)">(\s*)<h2>([^<]*)<\/h2>(\s*)<ul>((?:(?!<\/ul>)[\s\S])*?)(\n([ \t]*)<\/ul>)/g;
const LINK_RE = /<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g;

const decode = (s: string) => s.replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => text(s).replace(/"/g, "&quot;");
const isExternal = (href: string) => /^https:/i.test(href);

function links(html: string): MenuLink[] {
  return [...html.matchAll(LINK_RE)].map((m) => ({ label: decode(m[2]!.trim()), href: decode(m[1]!) }));
}

/** The header or footer block of a page, which must appear exactly once. */
function block(html: string, open: string, close: string, what: string) {
  const start = html.indexOf(open);
  const end = start < 0 ? -1 : html.indexOf(close, start);
  if (start < 0 || end < 0 || html.indexOf(open, start + 1) >= 0) throw new Error(`This page's site ${what} isn't in the expected form.`);
  return { start, end: end + close.length };
}
const header = (html: string) => block(html, `<header class="site-header">`, "</header>", "header");
const footer = (html: string) => block(html, `<footer class="site-footer">`, "</footer>", "footer");

function headerParts(h: string) {
  const nav = NAV_RE.exec(h), cta = CTA_RE.exec(h);
  if (!nav || !cta) throw new Error("This page's site header isn't in the expected form.");
  return { nav, cta };
}

/** Reads the menus from a page's HTML. */
export function readMenus(html: string): Menus {
  const hb = header(html), fb = footer(html);
  const { nav, cta } = headerParts(html.slice(hb.start, hb.end));
  const cols = [...html.slice(fb.start, fb.end).matchAll(COL_RE)].map((m) => ({ heading: decode(m[3]!.trim()), links: links(m[5]!) }));
  return { header: { links: links(nav[2]!), button: { label: decode(cta[4]!.trim()), href: decode(cta[2]!) } }, footer: cols };
}

function linkHtml(l: MenuLink, current?: string) {
  const extra = isExternal(l.href) ? ` target="_blank" rel="noopener"` : l.href === current ? ` aria-current="page"` : "";
  return `<a href="${attr(l.href)}"${extra}>${text(l.label)}</a>`;
}

/** Writes menus into a page's header and footer. `pageFile` (e.g. "about.html") marks the current page's header link. */
export function applyMenus(html: string, menus: Menus, pageFile: string): string {
  const hb = header(html), fb = footer(html);
  if (fb.start < hb.end) throw new Error("This page's site footer isn't in the expected form.");
  headerParts(html.slice(hb.start, hb.end));
  const h = html.slice(hb.start, hb.end)
    .replace(NAV_RE, (_m, open: string, _inner: string, close: string, indent: string) =>
      open + menus.header.links.map((l) => `\n${indent}  ${linkHtml(l, pageFile)}`).join("") + close)
    .replace(CTA_RE, (_m, a: string, _href: string, mid: string, _label: string, end: string) =>
      a + attr(menus.header.button.href) + mid + text(menus.header.button.label) + end);

  const f0 = html.slice(fb.start, fb.end);
  if ([...f0.matchAll(COL_RE)].length !== menus.footer.length) throw new Error("This page's site footer isn't in the expected form.");
  let col = 0;
  const f = f0.replace(COL_RE, (_m, _label: string, s1: string, _h: string, s2: string, inner: string, close: string, indent: string) => {
    const c = menus.footer[col++]!;
    // Items that aren't links (the "Cookie settings" button) stay at the end of the column.
    const others = inner.split("\n").filter((line) => /<li>/.test(line) && !/<li><a /.test(line)).map((line) => `\n${line}`).join("");
    const items = c.links.map((l) => `\n${indent}  <li>${linkHtml(l)}</li>`).join("");
    return `<nav aria-label="${attr(c.heading)}">${s1}<h2>${text(c.heading)}</h2>${s2}<ul>${items}${others}${close}`;
  });
  return html.slice(0, hb.start) + h + html.slice(hb.end, fb.start) + f + html.slice(fb.end);
}

/* ---------- validation ---------- */

export type MenuCheck = { ok: true; menus: Menus } | { ok: false; errors: Record<string, string> };

/**
 * Checks menus sent by the admin. `known` holds the site's own page links ("about.html", "./", …); anything else
 * must be a full https:// address. `columns` is the number of footer columns the site has.
 */
export function validateMenus(input: unknown, known: Set<string>, columns = 3): MenuCheck {
  const errors: Record<string, string> = {};
  const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

  const label = (v: unknown, path: string, what = "Label") => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    if (!s) errors[path] = `${what} is required.`;
    else if (s.length > MENU_LIMITS.label) errors[path] = `${what} can be at most ${MENU_LIMITS.label} characters.`;
    return s;
  };
  const href = (v: unknown, path: string) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (known.has(s)) return s;
    const url = safeHttpsUrl(s, MENU_LIMITS.href);
    if (!s) errors[path] = "Choose a page or enter a link.";
    else if (!url) errors[path] = "Choose a page from the list, or enter a full https:// address.";
    return url ?? s;
  };
  const list = (v: unknown, path: string, max: number): MenuLink[] => {
    if (!Array.isArray(v)) { errors[path] = "Invalid links."; return []; }
    if (v.length === 0) errors[path] = "Add at least one link.";
    if (v.length > max) errors[path] = `At most ${max} links here.`;
    return v.slice(0, max + 1).map((item, i) => {
      const o = obj(item);
      return { label: label(o?.label, `${path}.${i}.label`), href: href(o?.href, `${path}.${i}.href`) };
    });
  };

  const root = obj(input);
  const header = obj(root?.header);
  if (!root || !header || !Array.isArray(root.footer)) return { ok: false, errors: { menus: "Invalid menus." } };
  if (root.footer.length !== columns) return { ok: false, errors: { footer: `The footer has ${columns} columns.` } };

  const button = obj(header.button);
  const menus: Menus = {
    header: {
      links: list(header.links, "header.links", MENU_LIMITS.header),
      button: { label: label(button?.label, "header.button.label", "Button label"), href: href(button?.href, "header.button.href") }
    },
    footer: root.footer.map((c, i) => {
      const o = obj(c);
      return { heading: label(o?.heading, `footer.${i}.heading`, "Heading"), links: list(o?.links, `footer.${i}.links`, MENU_LIMITS.column) };
    })
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, menus };
}
