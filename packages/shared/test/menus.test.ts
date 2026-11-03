import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMenus, readMenus, validateMenus, MENU_LIMITS, type Menus } from "../src/menus.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const files = readdirSync(root).filter((f) => f.endsWith(".html"));
const page = (f: string) => readFileSync(join(root, f), "utf8");
const known = new Set(files.map((f) => (f === "index.html" ? "./" : f)));

describe("readMenus", () => {
  it("reads the header links, the button and the three footer columns", () => {
    const m = readMenus(page("index.html"));
    expect(m.header.links.map((l) => l.label)).toEqual(["How it works", "Features", "About", "Contact"]);
    expect(m.header.links[0]).toEqual({ label: "How it works", href: "how-it-works.html" });
    expect(m.header.button).toEqual({ label: "Get the app", href: "get-app.html" });
    expect(m.footer.map((c) => c.heading)).toEqual(["Product", "Resources", "Company"]);
    expect(m.footer[2]!.links.at(-1)).toEqual({ label: "Terms & Conditions", href: "terms-and-condition.html" });
  });

  it("reads the same menus from every page", () => {
    const home = readMenus(page("index.html"));
    for (const f of files) expect(readMenus(page(f)), f).toEqual(home);
  });
});

describe("applyMenus", () => {
  it("gives back every page unchanged when the menus are unchanged", () => {
    for (const f of files) {
      const html = page(f);
      expect(applyMenus(html, readMenus(html), f), f).toBe(html);
    }
  });

  it("writes new labels, links and order into the header and footer only", () => {
    const html = page("about.html");
    const m = readMenus(html);
    m.header.links = [m.header.links[2]!, { label: "FAQ & help", href: "faq.html" }];
    m.header.button = { label: "Download", href: "download.html" };
    m.footer[0]!.heading = "The app";
    m.footer[1]!.links.push({ label: "TPS", href: "https://tps.ltd/" });
    const out = applyMenus(html, m, "about.html");

    expect(readMenus(out)).toEqual(m);
    expect(out).toContain(`<a href="about.html" aria-current="page">About</a>`);
    expect(out).toContain(`<a href="faq.html">FAQ &amp; help</a>`);
    expect(out).not.toContain(`<a href="how-it-works.html">How it works</a>\n        <a href="features.html">`);
    expect(out).toMatch(/<a class="nav-cta" href="download.html">[\s\S]*?<\/svg>\s*Download\s*<\/a>/);
    expect(out).toContain(`<nav aria-label="The app">\n        <h2>The app</h2>`);
    expect(out).toContain(`<li><a href="https://tps.ltd/" target="_blank" rel="noopener">TPS</a></li>`);
    expect(out).toContain("data-cookie-settings>Cookie settings</button></li>");
    // Everything outside the header and footer is untouched.
    const main = (s: string) => s.slice(s.indexOf("</header>"), s.indexOf(`<footer class="site-footer">`));
    expect(main(out)).toBe(main(html));
  });

  it("never rewrites anything outside the header and footer, and stops on unexpected markup", () => {
    const html = page("index.html");
    const m = readMenus(html);
    // Nav closing on the same line as its last link: must not run on into the page body.
    const oneLine = html.replace(/(<a href="contact.html">Contact<\/a>)\n\s*<\/nav>/, "$1</nav>");
    expect(() => applyMenus(oneLine, m, "index.html")).toThrow(/header/);
    // Button without its icon: must not pick up a later link in the page.
    const noIcon = html.replace(/(<a class="nav-cta" href="get-app.html">)[\s\S]*?<\/svg>/, "$1");
    expect(() => applyMenus(noIcon, m, "index.html")).toThrow(/header/);
    // Wrong number of footer columns.
    expect(() => applyMenus(html, { ...m, footer: m.footer.slice(0, 2) }, "index.html")).toThrow(/footer/);
  });

  it("escapes labels and links", () => {
    const html = page("index.html");
    const m = readMenus(html);
    m.header.links[0] = { label: `<img src=x onerror=alert(1)>`, href: `https://x.test/"onmouseover="a` };
    const out = applyMenus(html, m, "index.html");
    expect(out).toContain(`<a href="https://x.test/&quot;onmouseover=&quot;a" target="_blank" rel="noopener">&lt;img src=x onerror=alert(1)&gt;</a>`);
  });
});

describe("validateMenus", () => {
  const good = (): Menus => readMenus(page("index.html"));

  it("accepts the current menus, trimming labels", () => {
    const m = good();
    m.header.links[0]!.label = "  How it works ";
    const r = validateMenus(m, known);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.menus.header.links[0]!.label).toBe("How it works");
  });

  it("refuses unknown pages, non-https links and script links", () => {
    for (const href of ["nope.html", "http://tps.ltd/", "javascript:alert(1)", "//evil.test/", "https://", "https://a b.test/",
      "https:evil.test", "https://liveaccess.ai@evil.test/", "https://user:pw@tps.ltd/", "https://tps.ltd/\u0007x", "https://tps.ltd/‮x"]) {
      const m = good();
      m.header.links[0]!.href = href;
      const r = validateMenus(m, known);
      expect(r.ok, href).toBe(false);
      if (!r.ok) expect(r.errors["header.links.0.href"], href).toBeTruthy();
    }
  });

  it("stores external links in their normalised form", () => {
    const m = good();
    m.header.links[0]!.href = "https://TPS.ltd";
    const r = validateMenus(m, known);
    expect(r.ok && r.menus.header.links[0]!.href).toBe("https://tps.ltd/");
  });

  it("enforces the limits", () => {
    const m = good();
    m.header.links = Array.from({ length: MENU_LIMITS.header + 1 }, () => ({ label: "FAQ", href: "faq.html" }));
    m.footer[0]!.links = Array.from({ length: MENU_LIMITS.column + 1 }, () => ({ label: "FAQ", href: "faq.html" }));
    m.footer[1]!.heading = "";
    m.header.button.label = "x".repeat(MENU_LIMITS.label + 1);
    const r = validateMenus(m, known);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["footer.0.links", "footer.1.heading", "header.button.label", "header.links"]);
  });

  it("refuses a different number of footer columns and malformed data", () => {
    const m = good();
    m.footer.pop();
    expect(validateMenus(m, known).ok).toBe(false);
    expect(validateMenus(null, known).ok).toBe(false);
    expect(validateMenus({ header: { links: "x" } }, known).ok).toBe(false);
  });
});
