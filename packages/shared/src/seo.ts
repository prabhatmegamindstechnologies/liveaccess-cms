// Site-wide SEO: the generated sitemap, robots.txt and llms.txt checks, redirect rules and SEO defaults.
import { hasHiddenChars, safeHttpsUrl } from "./links.ts";

export const SITE_ORIGIN = "https://liveaccess.ai";
export const REDIRECT_LIMIT = 500;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/* ---------- sitemap ---------- */

export type SitemapEntry = { path: string; lastmod: string | Date };

/** sitemap.xml for the given pages ("" = home, "about.html", …), in the same layout as the hand-written file. */
export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => `  <url><loc>${esc(`${SITE_ORIGIN}/${e.path}`)}</loc><lastmod>${day(e.lastmod)}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/* ---------- robots.txt and llms.txt ---------- */

/** A problem with robots.txt text, or null when it's fine to save. */
export function checkRobots(text: string): string | null {
  if (text.length > 20_000) return "robots.txt is too long (max 20,000 characters).";
  if (hasHiddenChars(text)) return "robots.txt contains characters that aren't allowed.";
  if (!/^\s*sitemap:\s*https:\/\/liveaccess\.ai\/sitemap\.xml\s*$/im.test(text)) {
    return "Keep the line \"Sitemap: https://liveaccess.ai/sitemap.xml\" so search engines can find every page.";
  }
  // Group rules by their User-agent lines (consecutive User-agent lines share one group).
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase(), value = m[2]!.trim();
    if (key === "user-agent") {
      if (inRules) { agents = []; inRules = false; }
      agents.push(value);
    } else {
      inRules = true;
      // "/", "/*", "/$" and "/*$" all match every address.
      if (key === "disallow" && /^\/\*?\$?$/.test(value) && agents.includes("*")) {
        return "This would block the whole site for all search engines (\"Disallow: /\" under \"User-agent: *\").";
      }
    }
  }
  return null;
}

/** A problem with llms.txt text, or null. */
export function checkLlms(text: string): string | null {
  if (!text.trim()) return "llms.txt can't be empty.";
  if (text.length > 100_000) return "llms.txt is too long (max 100,000 characters).";
  if (hasHiddenChars(text)) return "llms.txt contains characters that aren't allowed.";
  if (/<\s*(script|iframe|object|embed|style)\b/i.test(text)) return "llms.txt is plain text (Markdown); HTML tags like <script> aren't allowed.";
  return null;
}

/* ---------- redirects ---------- */

export type Redirect = { from: string; to: string; code: 301 | 302 };
export type RedirectCheck = { ok: true; redirects: Redirect[] } | { ok: false; errors: Record<string, string> };

const FROM_RE = /^\/[A-Za-z0-9\-._~/]*$/;

/** The site path a target points to, when it points into this site ("about.html" → "/about.html"). */
function sitePath(to: string, pages: Set<string>): string | null {
  if (pages.has(to)) return to === "./" ? "/" : `/${to}`;
  try {
    const u = new URL(to);
    const host = u.hostname.replace(/\.$/, "");
    if (host === "liveaccess.ai" || host === "www.liveaccess.ai") {
      try { return decodeURIComponent(u.pathname); } catch { return u.pathname; }
    }
  } catch { /* not a URL */ }
  return null;
}

/** Only old page addresses can be redirected: no file extension other than .html, no hidden (dot) folders. */
function isPageAddress(from: string) {
  const segments = from.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith("."))) return false;
  const last = segments.at(-1) ?? "";
  return !last.includes(".") || /^[^.]+\.html$/.test(last);
}

/**
 * Checks redirect rules. `pages` holds the site's own page links ("./", "about.html", …): an old address can't be a
 * real page (with or without .html), and a new address is one of them or a full https:// URL. `files` adds other
 * real .html files on the site ("/404.html", …) that must not be redirected either.
 * Targets may not contain `$` or `%{`/`%1` so they stay literal in Apache rewrite rules.
 */
export function validateRedirects(input: unknown, pages: Set<string>, adminPath = "la-studio", files: Set<string> = new Set()): RedirectCheck {
  if (!Array.isArray(input)) return { ok: false, errors: { redirects: "Invalid redirects." } };
  if (input.length > REDIRECT_LIMIT) return { ok: false, errors: { redirects: `At most ${REDIRECT_LIMIT} redirects.` } };

  const taken = new Set<string>();
  for (const p of pages) {
    const path = p === "./" ? "/" : `/${p}`;
    taken.add(path);
    if (path.endsWith(".html")) { taken.add(path.slice(0, -5)); taken.add(`${path.slice(0, -5)}/`); }
  }
  taken.add("/index.html");
  for (const f of files) {
    taken.add(f);
    if (f.endsWith(".html")) taken.add(f.slice(0, -5));
  }

  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const out: Redirect[] = input.map((item, i) => {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const from = typeof o.from === "string" ? o.from.trim() : "";
    const rawTo = typeof o.to === "string" ? o.to.trim() : "";
    const code = o.code === 301 || o.code === 302 ? o.code : null;

    if (!FROM_RE.test(from) || from.length > 200) errors[`${i}.from`] = "Start with / and use only letters, numbers, - _ . / (no ? or #).";
    else if (/\/\.{1,2}(\/|$)|\/\//.test(from)) errors[`${i}.from`] = "Remove the empty, . or .. parts from this address.";
    else if (!isPageAddress(from)) errors[`${i}.from`] = "Only old page addresses can be redirected (ending in .html or with no extension), not files or hidden folders.";
    else if (taken.has(from)) errors[`${i}.from`] = "This address is a page on the site. Pick an address that no longer exists.";
    // Apache's Redirect also matches everything under the address, so this would move every image on the site.
    else if (from === "/images" || from.startsWith("/images/")) errors[`${i}.from`] = "This is the site's images folder, so it can't be redirected.";
    else if (from === `/${adminPath}` || from.startsWith(`/${adminPath}/`)) errors[`${i}.from`] = "Admin addresses can't be redirected.";
    else if (seen.has(from)) errors[`${i}.from`] = "There is already a redirect from this address.";
    seen.add(from);

    const url = pages.has(rawTo) ? rawTo : safeHttpsUrl(rawTo);
    // Server variables (%{…}), backreferences ($1, %1) would be expanded by Apache when the rule is written out.
    const to = url && !/\$|%\{|%\d/.test(url) ? url : null;
    if (!to) errors[`${i}.to`] = !rawTo ? "Choose where this address should go."
      : url ? "This address can't contain $ or %{ or % followed by a digit." : "Choose a page from the list, or enter a full https:// address.";
    if (code === null) errors[`${i}.code`] = "Choose 301 (permanent) or 302 (temporary).";
    return { from, to: to ?? rawTo, code: code ?? 301 };
  });

  // A target that is itself redirected makes a chain (or a loop); visitors and search engines should get one hop.
  const froms = new Set(out.filter((_, i) => !errors[`${i}.from`]).map((r) => r.from));
  out.forEach((r, i) => {
    if (errors[`${i}.to`] || errors[`${i}.from`]) return;
    const path = sitePath(r.to, pages);
    if (path === r.from) errors[`${i}.to`] = "A redirect can't point to itself.";
    else if (path && froms.has(path)) errors[`${i}.to`] = `${path} is redirected too. Point straight to the final page instead.`;
  });

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, redirects: out };
}

/* ---------- defaults ---------- */

export type SeoDefaults = { description: string; shareImage: string; cardType: "summary" | "summary_large_image" };
export type DefaultsCheck = { ok: true; defaults: SeoDefaults } | { ok: false; errors: Record<string, string> };

const IMAGE_PATH = /^(?!.*\.\.)[a-z0-9][a-z0-9._/-]*\.(png|jpe?g|webp)$/i;

export function validateDefaults(input: unknown): DefaultsCheck {
  const o = (input && typeof input === "object" && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!o) return { ok: false, errors: { defaults: "Invalid defaults." } };
  const errors: Record<string, string> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

  const description = str(o.description);
  if (description.length > 300) errors.description = "Description can be at most 300 characters.";

  const img = str(o.shareImage);
  const shareImage = IMAGE_PATH.test(img) ? img : safeHttpsUrl(img);
  if (!shareImage) errors.shareImage = "Use an image on the site (e.g. logo.png or images/share.png) or a full https:// address.";

  const cardType = o.cardType === "summary" || o.cardType === "summary_large_image" ? o.cardType : null;
  if (!cardType) errors.cardType = "Choose a card type.";

  if (hasHiddenChars(description)) errors.description ??= "Remove the hidden characters.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, defaults: { description, shareImage: shareImage!, cardType: cardType! } };
}
