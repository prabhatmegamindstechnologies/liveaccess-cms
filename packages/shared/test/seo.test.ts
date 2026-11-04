import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSitemap, checkLlms, checkRobots, validateDefaults, validateRedirects, REDIRECT_LIMIT, type Redirect } from "../src/seo.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const file = (f: string) => readFileSync(join(root, f), "utf8");
const pages = new Set(["./", "about.html", "faq.html", "features.html", "guide-evaporator-fouling.html"]);

describe("buildSitemap", () => {
  it("rebuilds today's sitemap.xml exactly from its URLs and dates", () => {
    const today = file("sitemap.xml");
    const entries = [...today.matchAll(/<loc>https:\/\/liveaccess\.ai\/([^<]*)<\/loc><lastmod>([^<]*)<\/lastmod>/g)].map((m) => ({ path: m[1]!, lastmod: m[2]! }));
    expect(entries).toHaveLength(26);
    expect(buildSitemap(entries).trim()).toBe(today.trim());
  });

  it("escapes addresses and formats dates", () => {
    const out = buildSitemap([{ path: "a&b.html", lastmod: new Date("2026-11-03T22:00:00Z") }]);
    expect(out).toContain("<loc>https://liveaccess.ai/a&amp;b.html</loc><lastmod>2026-11-03</lastmod>");
  });
});

describe("checkRobots", () => {
  it("accepts today's robots.txt", () => {
    expect(checkRobots(file("robots.txt"))).toBeNull();
  });

  it("refuses blocking the whole site for all crawlers", () => {
    expect(checkRobots("User-agent: *\nDisallow: /\n\nSitemap: https://liveaccess.ai/sitemap.xml")).toMatch(/whole site/);
    expect(checkRobots("User-agent: GPTBot\nUser-agent: *\ndisallow: /  # all\nSitemap: https://liveaccess.ai/sitemap.xml")).toMatch(/whole site/);
    expect(checkRobots("User-agent: *\nDisallow: /*\nSitemap: https://liveaccess.ai/sitemap.xml")).toMatch(/whole site/);
    expect(checkRobots("User-agent: *\nDisallow: /$\nSitemap: https://liveaccess.ai/sitemap.xml")).toMatch(/whole site/);
  });

  it("allows blocking one folder, or one crawler", () => {
    expect(checkRobots("User-agent: *\nDisallow: /drafts/\n\nUser-agent: BadBot\nDisallow: /\n\nSitemap: https://liveaccess.ai/sitemap.xml")).toBeNull();
  });

  it("needs the Sitemap line and a sane size", () => {
    expect(checkRobots("User-agent: *\nAllow: /\n")).toMatch(/Sitemap/);
    expect(checkRobots("Sitemap: https://liveaccess.ai/sitemap.xml\n" + "#".repeat(20_001))).toMatch(/too long/);
    expect(checkRobots("Sitemap: https://liveaccess.ai/sitemap.xml\n\u0000")).toMatch(/characters/);
  });
});

describe("checkLlms", () => {
  it("accepts today's llms.txt and refuses empty, huge or HTML text", () => {
    expect(checkLlms(file("llms.txt"))).toBeNull();
    expect(checkLlms("  ")).toMatch(/empty/);
    expect(checkLlms("x".repeat(100_001))).toMatch(/too long/);
    expect(checkLlms("# Hi\n<script>alert(1)</script>")).toMatch(/HTML/);
  });
});

describe("validateRedirects", () => {
  const ok = (list: Redirect[]) => validateRedirects(list, pages);

  it("accepts simple rules and normalises them", () => {
    const r = ok([
      { from: "/old-faq", to: "faq.html", code: 301 },
      { from: " /promo ", to: "https://TPS.ltd", code: 302 }
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirects).toEqual([{ from: "/old-faq", to: "faq.html", code: 301 }, { from: "/promo", to: "https://tps.ltd/", code: 302 }]);
  });

  it("refuses bad old addresses, existing pages and duplicates", () => {
    const r = ok([
      { from: "old", to: "faq.html", code: 301 },
      { from: "/about.html", to: "faq.html", code: 301 },
      { from: "/about", to: "faq.html", code: 301 },
      { from: "/", to: "faq.html", code: 301 },
      { from: "/x?y=1", to: "faq.html", code: 301 },
      { from: "/la-studio/x", to: "faq.html", code: 301 },
      { from: "/dup", to: "faq.html", code: 301 },
      { from: "/dup", to: "about.html", code: 301 },
      { from: "/a/../b", to: "faq.html", code: 301 }
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["0.from", "1.from", "2.from", "3.from", "4.from", "5.from", "7.from", "8.from"]);
  });

  it("only redirects old page addresses, never site files or hidden folders", () => {
    const files = new Set(["/404.html", "/download.html"]);
    const bad = ["/menu.js", "/robots.txt", "/sitemap.xml", "/common.css", "/images/a.png", "/.well-known/acme-challenge/x", "/.htaccess", "/a/.git/x", "/404.html", "/download"];
    for (const from of bad) {
      const r = validateRedirects([{ from, to: "faq.html", code: 301 }], pages, "la-studio", files);
      expect(r.ok, from).toBe(false);
    }
    for (const from of ["/old-page", "/old-page.html", "/blog/2024/post", "/blog/"]) {
      expect(validateRedirects([{ from, to: "faq.html", code: 301 }], pages, "la-studio", files).ok, from).toBe(true);
    }
  });

  it("refuses server variables and backreferences in targets", () => {
    for (const to of ["https://evil.test/?%{HTTP_COOKIE}", "https://evil.test/$1", "https://evil.test/%1x"]) {
      const r = validateRedirects([{ from: "/a", to, code: 301 }], pages);
      expect(r.ok, to).toBe(false);
    }
  });

  it("sees through disguised chains", () => {
    const r = validateRedirects([
      { from: "/a", to: "https://liveaccess.ai./b", code: 301 },
      { from: "/b", to: "faq.html", code: 301 }
    ], pages);
    expect(r.ok).toBe(false);
  });

  it("refuses bad targets and codes", () => {
    const r = ok([
      { from: "/a", to: "nope.html", code: 301 },
      { from: "/b", to: "javascript:alert(1)", code: 301 },
      { from: "/c", to: "faq.html", code: 307 as 301 }
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["0.to", "1.to", "2.code"]);
  });

  it("refuses chains and loops", () => {
    const r = ok([
      { from: "/a", to: "https://liveaccess.ai/b", code: 301 },
      { from: "/b", to: "faq.html", code: 301 },
      { from: "/self", to: "https://liveaccess.ai/self", code: 301 }
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors["0.to"]).toMatch(/redirected/);
      expect(r.errors["2.to"]).toMatch(/itself|redirected/);
    }
  });

  it("caps the number of rules", () => {
    const many = Array.from({ length: REDIRECT_LIMIT + 1 }, (_, i) => ({ from: `/r${i}`, to: "faq.html", code: 301 as const }));
    const r = ok(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.redirects).toMatch(/At most/);
    expect(validateRedirects("x", pages).ok).toBe(false);
  });
});

describe("validateDefaults", () => {
  const good = { description: "The 24/7 service app from TPS.", shareImage: "logo.png", cardType: "summary" };

  it("accepts good values, trimming text", () => {
    const r = validateDefaults({ ...good, description: "  The 24/7   service app. " });
    expect(r.ok && r.defaults.description).toBe("The 24/7 service app.");
    expect(validateDefaults({ ...good, shareImage: "https://liveaccess.ai/images/share.png", cardType: "summary_large_image" }).ok).toBe(true);
  });

  it("refuses bad values", () => {
    const r = validateDefaults({ description: "x".repeat(301), shareImage: "../secret.png", cardType: "big" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["cardType", "description", "shareImage"]);
    expect(validateDefaults({ ...good, shareImage: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateDefaults(null).ok).toBe(false);
  });
});

describe("redirects from the images folder", () => {
  it("are refused, because Apache would also move everything under the address", () => {
    for (const from of ["/images", "/images/old.html"]) {
      expect(validateRedirects([{ from, to: "./", code: 301 }], new Set(["./"])).ok, from).toBe(false);
    }
  });
});
