import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyConsentJs, applyContactForm, applyListing, applyPageSeo, applySeoDefaults, applySiteSettings, readHtaccessRedirects, redirectsHtaccess, type ListingItem } from "../src/publish.ts";
import type { SiteSettings } from "../src/site-settings.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const files = readdirSync(root).filter((f) => f.endsWith(".html"));
const page = (f: string) => readFileSync(join(root, f), "utf8");

const live: SiteSettings = {
  siteName: "LiveAccess",
  tagline: "The 24/7 service app from TPS for dairy, food and beverage plants.",
  appStore: "https://apps.apple.com/app/liveaccess-24-7/id6790754198",
  playStore: "https://play.google.com/store/apps/details?id=com.liveaccess.app",
  email: "liveaccess@tps.ltd",
  notifyEmail: "",
  ga4: "G-JFHJD3T51M",
  gtm: ""
};
const was = { email: live.email };

const seoOf = (html: string) => ({
  title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "",
  description: /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "",
  canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "",
  noindex: /<meta name="robots" content="[^"]*noindex/.test(html)
});

describe("applyPageSeo", () => {
  it("gives back every page unchanged when the SEO values are unchanged", () => {
    for (const f of files) {
      const html = page(f);
      const s = seoOf(html);
      const decoded = { ...s, title: s.title.replace(/&amp;/g, "&"), description: s.description.replace(/&amp;/g, "&").replace(/&quot;/g, `"`) };
      expect(applyPageSeo(html, decoded), f).toBe(html);
    }
  });

  it("writes a new title, description and canonical into the page and its social tags", () => {
    const out = applyPageSeo(page("about.html"), { title: "New title", description: "New description", canonical: "https://liveaccess.ai/about-us.html", noindex: false });
    expect(out).toContain("<title>New title</title>");
    expect(out).toContain(`<meta name="description" content="New description"`);
    expect(out).toContain(`<link rel="canonical" href="https://liveaccess.ai/about-us.html"`);
    expect(out).toContain(`<meta property="og:title" content="New title"`);
    expect(out).toContain(`<meta property="og:description" content="New description"`);
    expect(out).toContain(`<meta property="og:url" content="https://liveaccess.ai/about-us.html"`);
  });

  it("escapes values, so a title can't break out of the tag", () => {
    const out = applyPageSeo(page("about.html"), { ...seoOf(page("about.html")), title: `</title><script>alert(1)</script> "$&"` });
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("&lt;/title&gt;");
    expect(out).toContain("$&amp;");
  });

  it("adds and removes noindex", () => {
    const html = page("about.html");
    const hidden = applyPageSeo(html, { ...seoOf(html), noindex: true });
    expect(hidden).toContain(`<meta name="robots" content="noindex" />`);
    expect(applyPageSeo(hidden, { ...seoOf(html), noindex: false })).toBe(html);
  });

  it("leaves the title and canonical alone when they are empty", () => {
    const html = page("about.html");
    expect(applyPageSeo(html, { ...seoOf(html), title: "", canonical: "" })).toBe(html);
  });

  it("throws instead of guessing when the page has no title tag", () => {
    expect(() => applyPageSeo("<html></html>", { title: "New", description: "", canonical: "", noindex: false })).toThrow(/expected form/);
  });
});

describe("applySiteSettings", () => {
  it("gives back every page unchanged when the settings are the live values", () => {
    for (const f of files) expect(applySiteSettings(page(f), live, was), f).toBe(page(f));
  });

  it("changes the site name, only in og:site_name", () => {
    const html = page("about.html");
    const out = applySiteSettings(html, { ...live, siteName: `Live "Plus"` }, was);
    expect(out).toContain(`<meta property="og:site_name" content="Live &quot;Plus&quot;" />`);
    expect(out.replace(`content="Live &quot;Plus&quot;"`, `content="LiveAccess"`)).toBe(html);
  });

  it("changes the footer tagline and escapes it", () => {
    const out = applySiteSettings(page("about.html"), { ...live, tagline: "Plants & <people>" }, was);
    expect(out).toContain("Plants &amp; &lt;people&gt;<br />");
    expect(out).not.toContain(live.tagline);
  });

  it("changes store links and keeps each page's own referrer", () => {
    const appStore = "https://apps.apple.com/app/new/id1";
    const playStore = "https://play.google.com/store/apps/details?id=com.new.app";
    const html = page("guide-evaporator-fouling.html");
    const out = applySiteSettings(html, { ...live, appStore, playStore }, was);
    expect(out).not.toContain(live.appStore);
    expect(out).not.toContain("id=com.liveaccess.app");
    expect(out).toContain(appStore);
    expect(out).toContain("id=com.new.app&amp;referrer=utm_source%3Dwebsite%26utm_campaign%3Dguides");
  });

  it("changes the store links on the QR redirect page", () => {
    const out = applySiteSettings(page("download.html"), { ...live, appStore: "https://apps.apple.com/app/new/id1" }, was);
    expect(out).not.toContain(live.appStore);
  });

  it("changes the email everywhere and keeps the mailto subject", () => {
    for (const f of ["index.html", "privacy-policy.html"]) {
      const out = applySiteSettings(page(f), { ...live, email: "help@tps.ltd" }, was);
      expect(out, f).not.toContain("liveaccess@tps.ltd");
      expect(out, f).toContain("help@tps.ltd");
    }
    expect(applySiteSettings(page("privacy-policy.html"), { ...live, email: "help@tps.ltd" }, was)).toContain("mailto:help@tps.ltd?subject=");
  });

  it("changes every copy of the GA4 ID, and leaves pages without analytics alone", () => {
    const out = applySiteSettings(page("index.html"), { ...live, ga4: "G-NEW123456" }, was);
    expect(out).not.toContain(live.ga4);
    expect(out.match(/G-NEW123456/g)!.length).toBe(page("index.html").match(/G-JFHJD3T51M/g)!.length);
    expect(applySiteSettings(page("404.html"), { ...live, ga4: "G-NEW123456" }, was)).not.toContain("G-NEW123456");
  });
});

describe("applyConsentJs", () => {
  const js = page("consent.js");
  it("leaves the file alone when the ID is unchanged", () => expect(applyConsentJs(js, live.ga4)).toBe(js));
  it("writes a new ID", () => expect(applyConsentJs(js, "G-NEW123456")).toContain("var GA_ID = 'G-NEW123456';"));
  it("throws when the file isn't in the expected form", () => expect(() => applyConsentJs("var x;", "G-NEW123456")).toThrow(/expected form/));
  it("refuses an ID that isn't one", () => expect(() => applyConsentJs(js, "G-1';alert(1);'")).toThrow(/valid/));
});

describe("applySeoDefaults", () => {
  const d = { description: "Default description", shareImage: "logo.png", cardType: "summary" as const };

  it("gives back every page unchanged with the live defaults", () => {
    for (const f of files) expect(applySeoDefaults(page(f), d), f).toBe(page(f));
  });

  it("fills an empty description, never a written one", () => {
    const html = page("about.html");
    expect(applySeoDefaults(applyPageSeo(html, { ...seoOf(html), description: "" }), d)).toContain(`<meta name="description" content="Default description"`);
    expect(applySeoDefaults(html, d)).not.toContain("Default description");
  });

  it("sets the share image and card type", () => {
    const out = applySeoDefaults(page("about.html"), { ...d, shareImage: "images/share.png", cardType: "summary_large_image" });
    expect(out).toContain(`<meta property="og:image" content="https://liveaccess.ai/images/share.png"`);
    expect(out).toContain(`<meta name="twitter:card" content="summary_large_image"`);
    const full = applySeoDefaults(page("about.html"), { ...d, shareImage: "https://cdn.example.com/a.png?x=1&y=2" });
    expect(full).toContain(`content="https://cdn.example.com/a.png?x=1&amp;y=2"`);
  });
});

describe("redirects", () => {
  const list = [
    { from: "/old.html", to: "about.html", code: 301 as const },
    { from: "/older", to: "./", code: 302 as const },
    { from: "/away.html", to: "https://tps.ltd/page?a=1", code: 301 as const }
  ];

  it("writes mod_alias rules with site paths", () => {
    const text = redirectsHtaccess(list);
    expect(text).toContain("Redirect 301 /old.html /about.html\n");
    expect(text).toContain("Redirect 302 /older /\n");
    expect(text).toContain("Redirect 301 /away.html https://tps.ltd/page?a=1\n");
    expect(text).not.toContain("RewriteRule");
  });

  it("writes nothing when there are no redirects", () => expect(redirectsHtaccess([])).toBe(""));

  it("refuses a rule that would add a second directive", () => {
    expect(() => redirectsHtaccess([{ from: "/a b", to: "about.html", code: 301 }])).toThrow(/redirect/i);
    expect(() => redirectsHtaccess([{ from: "/a", to: "https://x.example/\nRewriteEngine Off", code: 301 }])).toThrow(/redirect/i);
    expect(() => redirectsHtaccess([{ from: "/a", to: "https://x.example/\\", code: 301 }])).toThrow(/redirect/i);
  });

  it("reads back what it wrote, and ignores everything else in the file", () => {
    const text = `RewriteEngine On\nRedirectMatch 301 ^/x /y\n${redirectsHtaccess(list)}`;
    expect(readHtaccessRedirects(text)).toEqual([
      { code: 301, from: "/old.html", to: "/about.html" },
      { code: 302, from: "/older", to: "/" },
      { code: 301, from: "/away.html", to: "https://tps.ltd/page?a=1" }
    ]);
  });
});

describe("applyListing", () => {
  /** The items a listing page already shows, as the build would pass them. */
  const itemsOf = (html: string): ListingItem[] =>
    [...html.matchAll(/href="(?:guide|area)-([a-z0-9-]+)\.html"><span class="feat-note">([^<]*)<\/span><h3 class="h3">([^<]*)<\/h3>/g)]
      .map((m) => ({ slug: m[1]!, note: m[2]!.replace(/&amp;/g, "&"), title: m[3]!.replace(/&amp;/g, "&"), summary: "A summary. More text.", summaryChanged: false }));
  const added: ListingItem = { slug: "new-guide", note: "High shear mixing", title: "New & <improved>", summary: "First sentence. Second one.", summaryChanged: true };
  const cards = (html: string) => html.match(/<a class="feat feat-link"/g)!.length;

  it("gives back both listing pages unchanged when nothing changed", () => {
    expect(applyListing(page("guides.html"), "guide", itemsOf(page("guides.html")))).toBe(page("guides.html"));
    expect(applyListing(page("process-areas.html"), "area", itemsOf(page("process-areas.html")))).toBe(page("process-areas.html"));
  });

  it("adds a new guide after the others, escaped, with the first sentence of its summary", () => {
    const html = page("guides.html");
    const out = applyListing(html, "guide", [added, ...itemsOf(html)]);
    expect(cards(out)).toBe(7);
    expect(out).toContain(`<a class="feat feat-link" href="guide-new-guide.html"><span class="feat-note">High shear mixing</span><h3 class="h3">New &amp; &lt;improved&gt;</h3><p>First sentence.</p></a>\n        </div>`);
  });

  it("adds it to the page's search-engine list too, numbered and safe inside the script", () => {
    const html = page("guides.html");
    const out = applyListing(html, "guide", [...itemsOf(html), { ...added, title: "Ends </script> here" }]);
    expect(out).toContain(`"position": 7,\n            "url": "https://liveaccess.ai/guide-new-guide.html",\n            "name": "Ends \\u003c/script> here"`);
    expect(out).not.toContain("Ends </script>");
  });

  it("adds a new area to a page without a search-engine list", () => {
    const html = page("process-areas.html");
    const out = applyListing(html, "area", [...itemsOf(html), { ...added, slug: "new-area", note: "Process area", title: "New area" }]);
    expect(cards(out)).toBe(9);
    expect(out).toContain(`href="area-new-area.html"><span class="feat-note">Process area</span><h3 class="h3">New area</h3>`);
  });

  it("changes a card's title and area, and keeps its hand-written text unless the summary changed", () => {
    const html = page("process-areas.html");
    const items = itemsOf(html).map((i) => (i.slug === "applications" ? { ...i, title: "Renamed" } : i));
    const out = applyListing(html, "area", items);
    expect(out).toContain(`<h3 class="h3">Renamed</h3><p>Applications is about the product itself.</p>`);
    const rewritten = applyListing(html, "area", items.map((i) => (i.slug === "applications" ? { ...i, summaryChanged: true } : i)));
    expect(rewritten).toContain(`<h3 class="h3">Renamed</h3><p>A summary.</p>`);
  });

  it("removes a card that isn't in the build, and keeps the page's order", () => {
    const html = page("guides.html");
    const items = itemsOf(html);
    const out = applyListing(html, "guide", items.slice(1).reverse());
    expect(cards(out)).toBe(5);
    expect(out).not.toContain(items[0]!.slug);
    expect(itemsOf(out).map((i) => i.slug)).toEqual(items.slice(1).map((i) => i.slug));
  });

  it("throws instead of guessing when the page has no cards", () => {
    expect(() => applyListing(page("about.html"), "guide", [added])).toThrow(/expected form/);
  });
});

describe("applyContactForm", () => {
  const raw = readFileSync(join(import.meta.dirname, "..", "..", "..", "contact.html"), "utf8");

  it("points the real contact form at the CMS and adds the time-on-page field and its script", () => {
    const out = applyContactForm(raw, "la-studio");
    expect(out).toContain(`<form class="form-card" id="contact-form" method="POST" action="/la-studio/api/contact" novalidate>`);
    expect(out).not.toContain("formspree");
    expect(out).toContain(`<input class="hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true" />\n          <input type="hidden" name="_elapsed" id="cf-elapsed" value="" />`);
    expect(out).toContain(`  <script>document.addEventListener('submit', function (e) { if (e.target.id === 'contact-form') document.getElementById('cf-elapsed').value = String(Math.round(performance.now())); }, true);</script>\n</body>`);
    // Nothing else changes.
    const back = out.replace("/la-studio/api/contact", "https://formspree.io/f/YOUR_FORM_ID")
      .replace(`\n          <input type="hidden" name="_elapsed" id="cf-elapsed" value="" />`, "")
      .replace(`  <script>document.addEventListener('submit', function (e) { if (e.target.id === 'contact-form') document.getElementById('cf-elapsed').value = String(Math.round(performance.now())); }, true);</script>\n`, "");
    expect(back).toBe(raw);
  });

  it("gives the same page when it runs twice", () => {
    const once = applyContactForm(raw, "la-studio");
    expect(applyContactForm(once, "la-studio")).toBe(once);
  });

  it("refuses a page whose form isn't in the expected form, and a bad admin path", () => {
    expect(() => applyContactForm(raw.replace('id="contact-form"', 'id="other"'), "la-studio")).toThrow(/expected form/);
    expect(() => applyContactForm(raw.replace('name="_gotcha"', 'name="x"'), "la-studio")).toThrow(/expected form/);
    expect(() => applyContactForm("<html><body></body></html>", "la-studio")).toThrow(/expected form/);
    for (const bad of ["", "a\"b", "../x", "LA"]) expect(() => applyContactForm(raw, bad), bad).toThrow(/admin path/);
  });
});
