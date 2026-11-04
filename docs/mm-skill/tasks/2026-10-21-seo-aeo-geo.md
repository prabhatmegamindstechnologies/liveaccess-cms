# Multi-page redesign + SEO / AEO / GEO for liveaccess.ai

- **Flow:** FEATURE
- **Dates:** 2026-10-21 → 2026-10-22
- **Branch:** MarketingUpdates
- **Status:** Built and verified locally — not committed or deployed
- **Design reference:** preview https://claude.ai/artifact/74db4HcYCANRzQA4GFj8ro
  (section idea from https://red-bamboo.com: How it works / About / Contact)

## Goal (done =)
liveaccess.ai becomes a multi-page site where each section has its own page and URL, in the new design,
with content that matches the real app (TPS-MobileApp), and every page carries its own SEO/AEO/GEO markup,
ready for the existing GitHub Action to deploy.

## Facts used
- Company (https://tps.ltd): TPS Pte Ltd, 36 Robinson Rd, #20-01, Singapore 068877 · TPS Europe ApS,
  Fuglehavevej 34, DK-2750 Ballerup. Equipment and process supplier for dairy, food, beverage, personal care.
- App features from TPS-MobileApp `src/config/planConfig.ts` (tier table), `NeedMoreHelpSheet.tsx`
  (video call), `expertCategories.ts` (Expert Network areas), screens/strings.
- Defaults applied because the questions were not answered (confirm with client):
  1. Contact form opens the visitor's email app (mailto) — no backend.
  2. "Free to download" used throughout.
  3. "50 years of experience" quoted from tps.ltd on About.

## What was built
| File | Change |
|---|---|
| `common.css` | New design tokens + components, self-hosted @font-face; legacy tokens kept for legal pages. Marketing styles scoped to `body.site` |
| `header.js` | Nav: How it works · Features · Plans · About · Contact + "Get the app" → get-app.html; active page; hamburger < 980px |
| `footer.js` | 3-column footer with all pages, TPS link |
| `index.html` | Rewritten: hero + example cited answer, problem timeline, teaser cards, get-app strip. Organization/WebSite/MobileApplication JSON-LD |
| `how-it-works.html` NEW | 4-step tab stepper with phone screens, comparison table. HowTo + Breadcrumb |
| `features.html` NEW | 8 features, audiences, 7 process areas. MobileApplication featureList |
| `plans.html` NEW | Tier 1 vs Tier 2, path to Tier 2. Offers ItemList |
| `about.html` NEW | TPS story, facts, offices. AboutPage + Organization |
| `faq.html` NEW | 11 Q&As in 3 groups. FAQPage (text identical to visible) |
| `contact.html` NEW | Email + copy, offices, mailto form. ContactPage + contactPoint |
| `get-app.html` | Restyled; `noindex` removed; MobileApplication JSON-LD |
| privacy / terms / delete-account | description + canonical; asset versions bumped |
| `download.html` | asset versions bumped only (still noindex) |
| `robots.txt`, `sitemap.xml`, `llms.txt` NEW | AI crawlers allowed; 11 URLs; AI-readable summary |
| `archivo.woff2`, `plex-sans.woff2`, `plex-mono.woff2` NEW | Self-hosted fonts (OFL) |
| `.github/workflows/deploy.yml` | `cp` now also copies `*.txt *.xml *.woff2` |

## Incident
Between sessions all untracked files (the 6 new pages, robots/sitemap/llms, fonts, this record) were deleted
from the working tree; tracked edits survived (pattern matches `git clean -f`). Recreated 2026-10-22 from the
session transcript. **Commit soon** so this can't recur.

## Verification (2026-10-22)
- `verify_site.py`: "Checked 12 pages, 11 FAQ entries, 4 HowTo steps, 11 sitemap URLs. All checks passed."
  (no broken local links, all JSON-LD parses, FAQ/HowTo JSON == visible text, unique title/description/canonical
  per page, sitemap complete, robots/sitemap/llms/fonts served 200).
- Headless Edge screenshots: home, how-it-works, plans, contact, privacy at 1366px; home, how-it-works at 375px.
  Bug found and fixed: footer headings inherited the large `.site h2` size.

## Security gate — PASS
Static pages; no secrets; no third-party requests; scripts don't inject HTML; mailto parameters URL-encoded;
external links `rel="noopener"`.

## Post-task review — APPROVED with notes
- Example content (homogenizer VFD answer, seal-kit question) is illustrative; labelled "Example answer" on home.
- Header still uses `document.write` (existing pattern); a build step would remove it — out of scope.
- Server must serve `.woff2` as `font/woff2`; check after first deploy.

## Open items
- Link from tps.ltd → liveaccess.ai (biggest SEO/GEO win, outside this repo).
- 1200×630 share image (logo.png used for now).
- After deploy: Google Rich Results Test on faq/how-it-works; submit sitemap in Search Console.
