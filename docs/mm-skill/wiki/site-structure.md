# Site structure and deploy

Updated 2026-10-22 for the multi-page redesign (task: `docs/mm-skill/tasks/2026-10-21-seo-aeo-geo.md`).

## Pages
- Marketing pages (`<body class="site">`, new design): `index.html`, `how-it-works.html`, `features.html`, `about.html`, `faq.html`, `contact.html`, `get-app.html`.
- Content decisions (2026-10-22, client request):
  - There is no Plans page.
  - No Tier 1 / Tier 2 or "TPS clients" wording on the marketing pages or in `llms.txt`. The legal pages still mention "service tier" until TPS approves a change.
  - About shows no office locations. Office addresses appear only on Contact.
  - TPS experience is **30 years**.
- Home links (logo, breadcrumbs) use `href="./"`, not `index.html`. That matches the canonical URL and avoids the browser caching `/` and `/index.html` as separate pages.
- Legal/utility pages (own typography, only header/footer are shared): `privacy-policy.html`, `terms-and-condition.html`, `delete-account.html`, `download.html` (QR redirect, `noindex`).
- Flat URLs in the repo root only. The deploy step does not copy subfolders.

## Shared files
- `header.js` / `footer.js` inject the header and footer with `document.write`. The header marks the current page (`aria-current`) by file name and turns into a hamburger menu below 980px. Top nav: How it works · Features · About · Contact, plus "Get the app" → `get-app.html`. FAQ is linked from the footer, not the top nav.
- `common.css`: legacy tokens (`--brand-orange`, `--text-secondary`, …) still used by the legal pages, plus the site tokens (`--ink`, `--orange`, `--slate`, …) and shared components. Everything for marketing pages is scoped under `.site` so it can't restyle the legal pages. Page-specific CSS stays in each page's `<style>` block.
- Design style since 2026-10-22 is **"Clarity"**: light, airy, with orange accents and navy (`--slate` #121826) dark boxes. Reference: https://claude.ai/artifact/NDvfgS7PGgLnEXgZt4eTAa. `.page-hero.dark` renders as a light hero with an orange glow. `.cta-band` renders as a rounded dark box. `contact.html` and `get-app.html` still use full-width dark heroes.
- Colour contrast rule (WCAG AA, fixed 2026-10-22): brand orange `#E8541A` measures only 3.46–3.68:1 against white and light greys.
  - Use it only for large text (≥ 24px, or ≥ 18.7px bold), icons, dots and borders.
  - For small orange text, and for orange backgrounds behind small white text, use `--orange-ink` `#C2410C` (5.18:1).
  - Grey text on light backgrounds must be `--muted` (`#6B7280`) or darker.
- Watch specificity:
  - `.site h2` beats a plain `.site-footer h2`, because the specificity is equal and it comes later in the file.
  - `.site a { color: inherit }` beats a plain class on a link, such as `.nav-cta`.
  - Header/footer rules therefore need the `.site-header` / `.site-footer .footer-inner` prefix.
- Fonts are self-hosted in the root: `plus-jakarta.woff2` (Plus Jakarta Sans, variable 400–800, used for all text) and `plex-mono.woff2` (500, used for small source/citation labels). They aren't loaded from Google, because of GDPR concerns for the EU office.
- Cache busting: pages load `common.css`, `header.js` and `footer.js` with `?v=2.1.1` (common.css) and `?v=2.1.2` (header.js, footer.js). Bump them on every page when a shared file changes.

## SEO / AEO / GEO
- Every indexable page has a unique `<title>`, meta description, canonical, Open Graph tags and JSON-LD. The organization uses `@id` `https://liveaccess.ai/#tps`, the app `https://liveaccess.ai/#app`.
- `faq.html` FAQPage and `how-it-works.html` HowTo JSON-LD must match the visible text word for word. Edit both together.
- `robots.txt` allows all crawlers, including AI crawlers. `sitemap.xml` lists every indexable page, so add new pages there. `llms.txt` is a plain summary for AI tools, so keep it in sync with features and tiers.

## Local preview and deploy
- Local preview: `python -m http.server 5500` from the repo root.
- Deploy: `.github/workflows/deploy.yml` runs on push to `main`. It copies only `*.html *.css *.js *.png *.svg *.mp4 *.txt *.xml *.woff2` from the repo root to the FTP server. **Any new file type or subfolder must be added to that `cp` line or it will not be deployed.**
- New files are untracked until the user commits them (Claude never commits in this repo). On 2026-10-22 all untracked files were wiped from the working tree once (it looked like `git clean`), so avoid commands that clean untracked files.
