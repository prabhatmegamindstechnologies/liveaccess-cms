// What the site build does to a finished page: writes page SEO, Site settings and SEO defaults into the page's own tags.
// Works on text, like menus.ts: a value that already matches leaves the page byte-for-byte as it was, and markup that
// isn't in the expected form throws instead of being guessed at.
import { firstSentence } from "./areas.ts";
import { SITE_ORIGIN, type Redirect, type SeoDefaults } from "./seo.ts";
import type { SiteSettings } from "./site-settings.ts";

export type PageSeo = { title: string; description: string; canonical: string; noindex: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s: string) => s.replace(/&quot;/g, `"`).replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// Each pattern has three groups: what comes before the value, the value, what comes after it.
const TITLE = /(<title>)([^<]*)(<\/title>)/;
const DESCRIPTION = /(<meta name="description" content=")([^"]*)(")/;
const CANONICAL = /(<link rel="canonical" href=")([^"]*)(")/;
const OG_TITLE = /(<meta property="og:title" content=")([^"]*)(")/;
const OG_DESCRIPTION = /(<meta property="og:description" content=")([^"]*)(")/;
const OG_URL = /(<meta property="og:url" content=")([^"]*)(")/;
const OG_IMAGE = /(<meta property="og:image" content=")([^"]*)(")/;
const OG_SITE = /(<meta property="og:site_name" content=")([^"]*)(")/;
const CARD = /(<meta name="twitter:card" content=")([^"]*)(")/;
const TAGLINE = /(<footer class="site-footer">[\s\S]*?<\/b><br \/>\s*)([^<]+?)(\s*<br \/>)/;
const ROBOTS = /\n[ \t]*<meta name="robots" content="([^"]*)" \/>/;

const current = (html: string, re: RegExp) => re.exec(html)?.[2] ?? null;
const matches = (html: string, re: RegExp, value: string) => {
  const now = current(html, re);
  return now !== null && flat(decode(now)) === flat(value);
};

/** Writes a value into a tag that must appear exactly once. A tag that's missing is fine when `optional`. */
function put(html: string, re: RegExp, value: string, what: string, optional = false) {
  const hits = html.match(new RegExp(re.source, "g"))?.length ?? 0;
  if (hits === 0 && optional) return html;
  if (hits !== 1) throw new Error(`This page's ${what} isn't in the expected form.`);
  if (matches(html, re, value)) return html;
  return html.replace(re, (_m, a: string, _v: string, b: string) => a + esc(value) + b);
}

/** Writes a page's SEO fields. An empty title or canonical means "keep the page's own". */
export function applyPageSeo(html: string, seo: PageSeo): string {
  let out = html;
  if (seo.title && !matches(out, TITLE, seo.title)) {
    out = put(out, TITLE, seo.title, "title");
    out = put(out, OG_TITLE, seo.title, "og:title", true);
  }
  if (!matches(out, DESCRIPTION, seo.description) && (seo.description || current(out, DESCRIPTION) !== null)) {
    out = put(out, DESCRIPTION, seo.description, "description");
    if (seo.description) out = put(out, OG_DESCRIPTION, seo.description, "og:description", true);
  }
  if (seo.canonical && !matches(out, CANONICAL, seo.canonical)) {
    out = put(out, CANONICAL, seo.canonical, "canonical");
    out = put(out, OG_URL, seo.canonical, "og:url", true);
  }

  const robots = ROBOTS.exec(out);
  const hidden = /noindex/i.test(robots?.[1] ?? "");
  if (!seo.noindex && hidden) return out.replace(ROBOTS, "");
  if (seo.noindex && !hidden) {
    if (robots) return out.replace(ROBOTS, `\n  <meta name="robots" content="noindex" />`);
    const tag = /<meta name="description" content="[^"]*" \/>/;
    if (!tag.test(out)) throw new Error("This page's description isn't in the expected form.");
    return out.replace(tag, (m) => `${m}\n  <meta name="robots" content="noindex" />`);
  }
  return out;
}

const swapAll = (s: string, from: string, to: string) => s.split(from).join(to);

/**
 * Writes Site settings into a page. `live` is what the site uses today (the email has no fixed place to find it from).
 * The Google Tag Manager ID isn't written: see the warning in the site build.
 */
export function applySiteSettings(html: string, s: SiteSettings, live: { email: string }): string {
  let out = put(html, OG_SITE, s.siteName, "og:site_name", true);
  out = put(out, TAGLINE, s.tagline, "footer tagline", true);

  // In an attribute "&" is escaped; in a script it stays as it is. "'" can't be left in a link inside a JS string.
  const app = s.appStore.replace(/'/g, "%27");
  out = out.replace(/(=")?https:\/\/apps\.apple\.com\/[^"'\s<>]*/g, (_m, attr?: string) => (attr ? `="${app.replace(/&/g, "&amp;")}` : app));
  // Only the base link: what follows it (each page's own &referrer=…) stays.
  out = out.replace(/https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+/g, () => s.playStore);

  if (live.email && live.email !== s.email) out = swapAll(out, live.email, s.email);
  const ga = /gtag\/js\?id=(G-[A-Z0-9]+)/.exec(out)?.[1];
  if (ga && ga !== s.ga4) out = swapAll(out, ga, s.ga4);
  return out;
}

/** Writes the GA4 ID into consent.js, which keeps its own copy. */
export function applyConsentJs(js: string, ga4: string): string {
  const re = /(var GA_ID = ')[^']*(';)/;
  if (!re.test(js)) throw new Error("consent.js isn't in the expected form.");
  if (!/^G-[A-Z0-9]+$/.test(ga4)) throw new Error("The Google Analytics 4 ID isn't valid.");
  return js.replace(re, (_m, a: string, b: string) => a + ga4 + b);
}

/** Writes the SEO defaults: the description only where a page has none, share image and card type everywhere. */
export function applySeoDefaults(html: string, d: SeoDefaults): string {
  let out = html;
  if (d.description && current(out, DESCRIPTION) === "") out = put(out, DESCRIPTION, d.description, "description");
  if (d.description && current(out, OG_DESCRIPTION) === "") out = put(out, OG_DESCRIPTION, d.description, "og:description");
  const image = /^https:/i.test(d.shareImage) ? d.shareImage : `${SITE_ORIGIN}/${d.shareImage}`;
  out = put(out, OG_IMAGE, image, "og:image", true);
  return put(out, CARD, d.cardType, "twitter:card", true);
}

/** One card on a listing page. `note` is the small label above the title; `summaryChanged` = differs from the live copy. */
export type ListingItem = { slug: string; title: string; note: string; summary: string; summaryChanged: boolean };

const CARD_LINE = /^([ \t]*)<a class="feat feat-link" href="(guide|area)-([a-z0-9-]+)\.html"><span class="feat-note">([^<]*)<\/span><h3 class="h3">([^<]*)<\/h3><p>([^<]*)<\/p><\/a>$/gm;
const ITEM_LIST = /("@type": "ItemList",\s*"itemListElement": \[\n)[\s\S]*?(\n[ \t]*\]\n)/;

/**
 * Keeps a listing page (guides.html, process-areas.html) in step with what was built. Cards keep the page's order, as
 * it's hand-made, and new items go at the end. A card's text is often shorter than the summary, so it's only rewritten
 * when the summary really changed.
 */
export function applyListing(html: string, kind: "guide" | "area", items: ListingItem[]): string {
  const found = [...html.matchAll(CARD_LINE)].filter((m) => m[2] === kind);
  const first = found[0], last = found.at(-1);
  if (!first || !last) throw new Error("This listing page isn't in the expected form.");
  const start = first.index, end = last.index + last[0].length;
  // Only cards may sit between the first and the last one, or lines of the page would be lost.
  if (html.slice(start, end).split("\n").length !== found.length) throw new Error("This listing page isn't in the expected form.");

  const indent = first[1]!;
  const card = (i: ListingItem, text: string) =>
    `${indent}<a class="feat feat-link" href="${kind}-${i.slug}.html"><span class="feat-note">${esc(i.note)}</span><h3 class="h3">${esc(i.title)}</h3><p>${text}</p></a>`;
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const kept = found.flatMap((m) => {
    const i = bySlug.get(m[3]!);
    if (!i) return [];
    const same = decode(m[4]!) === i.note && decode(m[5]!) === i.title && !i.summaryChanged;
    return [{ item: i, line: same ? m[0] : card(i, i.summaryChanged ? esc(firstSentence(i.summary)) : m[6]!) }];
  });
  const shown = new Set(kept.map((k) => k.item.slug));
  const all = [...kept, ...items.filter((i) => !shown.has(i.slug)).map((i) => ({ item: i, line: card(i, esc(firstSentence(i.summary))) }))];
  const out = html.slice(0, start) + all.map((a) => a.line).join("\n") + html.slice(end);

  // In a script, "<" can't be left in the name: it could close the script.
  const json = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c");
  const entry = (i: ListingItem, n: number) => `          {
            "@type": "ListItem",
            "position": ${n + 1},
            "url": "${SITE_ORIGIN}/${kind}-${i.slug}.html",
            "name": ${json(i.title)}
          }`;
  return out.replace(ITEM_LIST, (_m, a: string, b: string) => a + all.map((x, n) => entry(x.item, n)).join(",\n") + b);
}

const target = (to: string) => (/^https:/i.test(to) ? to : to === "./" ? "/" : `/${to}`);

/** Redirect rules for .htaccess (mod_alias, so nothing in them is expanded by Apache). Empty when there are none. */
export function redirectsHtaccess(list: Pick<Redirect, "from" | "to" | "code">[]): string {
  if (!list.length) return "";
  const lines = list.map((r) => {
    // Already checked on save; one rule must never be able to become two.
    if (/[\s"\\]/.test(r.from + r.to)) throw new Error(`The redirect from ${JSON.stringify(r.from)} can't be written.`);
    return `Redirect ${r.code} ${r.from} ${target(r.to)}\n`;
  });
  return `\n# Redirects from the CMS.\n${lines.join("")}`;
}

/** The rules written by redirectsHtaccess. */
export function readHtaccessRedirects(text: string) {
  return [...text.matchAll(/^Redirect (301|302) (\S+) (\S+)$/gm)].map((m) => ({ code: Number(m[1]) as 301 | 302, from: m[2]!, to: m[3]! }));
}
