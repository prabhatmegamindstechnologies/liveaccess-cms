# Redesign homepage in the "Clarity" style

- **Flow:** FEATURE
- **Date:** 2026-10-22
- **Branch:** MarketingUpdates
- **Status:** Built and verified locally. Not committed (user rule: never commit). Option (A) chosen: inner-page heroes and CTA bands restyled too.
- **Approved design:** https://claude.ai/artifact/NDvfgS7PGgLnEXgZt4eTAa (picked from the 6 directions at
  https://claude.ai/artifact/FxzrtVqdP4fZyGSCxE4Apy)
- **Builds on:** `2026-10-21-seo-aeo-geo.md` (multi-page site + SEO/AEO/GEO — kept as is)

## Goal (done =)
`index.html` matches the approved Clarity artifact, using the real site's pages in the nav, with all existing
SEO/AEO/GEO markup kept, checks passing, and correct on desktop and phone.

## Homepage sections (from the artifact)
1. **Hero** — pill "AI-powered technical search from TPS", "Every OEM manual. One question away.", live-site
   subline (milk, food and beverage production), store badges, phone with cited answer, 3 floating cards
   (source cited / search by photo / TPS engineer), trust strip.
2. **Why LiveAccess?** (`#why`) — live text + 3 benefit points + before/after panel with the homogenizer example.
3. **Key Features** (`#features`) — bento: AI-powered search (wide, dark), Instant document search (orange),
   Document viewer, Camera & voice search, Built for the plant floor, Talk to a TPS engineer (full-width, TPS clients).
   "All features →" link to `features.html`.
4. **How it works** (`#how`) — 4 step cards + "See it step by step →" link to `how-it-works.html`.
5. **Who It's For** (`#who`) — Process Engineers / Maintenance Teams / Factory Personnel + dark "The Result" band
   with 3 outcomes.
6. **Get the app** (`#get-app`) — dark CTA with badges + QR + liveaccess@tps.ltd.

## Files
| File | Change |
|---|---|
| `index.html` | Rewrite body + page CSS from the artifact. Keep `<head>` SEO block (title, description, canonical, OG, JSON-LD) unchanged. |
| `plus-jakarta.woff2` NEW | Self-hosted Plus Jakarta Sans (variable, latin), same GDPR reasoning as the other fonts. |
| `common.css` | Switch site fonts to Plus Jakarta Sans; restyle shared **header** (white blur bar, dark "Get the app" pill) and **footer** to Clarity. |
| `header.js` / `footer.js` | Markup unchanged except small class tweaks if needed; bump `?v=` to 2.1.0 on all pages. |

Header nav stays the real pages: How it works · Features · Plans · About · Contact · [Get the app].

## Decision for you: the other pages
Changing the shared header/footer/font means every page picks up the Clarity header, footer and font.
The inner pages (how-it-works, features, plans, about, faq, contact, get-app) would still have their
**dark slate hero bands**, which won't match the light Clarity homepage.
- **(A) Recommended:** also restyle the shared `.page-hero` and `.cta-band` classes in `common.css` to Clarity
  (light hero with orange glow, rounded dark CTA box). One CSS change, all inner pages match, page HTML untouched.
- **(B)** Homepage only now; inner pages stay dark until a later pass.

## Rejected alternatives
- Homepage-only font/header (separate CSS just for index) — two visual systems on one site; header would change
  when you click a menu link.
- Loading Plus Jakarta Sans from Google Fonts — GDPR concern (TPS Europe ApS); self-host like the others.

## Verification
- `verify_site.py` (links, JSON-LD, unique meta, sitemap, files served).
- Headless Edge screenshots: index at 1366px and 375px; one inner page + privacy at 1366px to check the shared header/footer.

## Before starting
- The multi-page work from 2026-10-21 is **still uncommitted** (it was wiped once). Recommend committing it on
  `MarketingUpdates` first so this redesign is a clean, reversible step. I'll only commit if you say so.

## Security
- Static page; floating-card animation respects `prefers-reduced-motion`; no new third-party requests.

## What was done
- `index.html`: rebuilt from the approved artifact (hero + phone + floating cards, trust strip, Why LiveAccess with
  before/after, Key Features bento, How it works, Who It's For + The Result, Get the app). `<head>` SEO block unchanged
  except font preload, cache version and theme-color (now white).
- `common.css`: Clarity tokens; Plus Jakarta Sans for all text (IBM Plex Mono kept for small source labels);
  white blur header with dark "Get the app" pill; footer restyled; `.page-hero.dark` → light hero with orange glow;
  `.cta-band` → rounded dark box; feature cards rounded; unused old-homepage classes removed.
- `plus-jakarta.woff2` added; `archivo.woff2` and `plex-sans.woff2` deleted (no longer used).
- All pages: `?v=2.1.0`, font preload swapped, theme-color white; FAQ hero link no longer styled white.
- Not restyled (still full-width dark heroes, now in the Clarity navy): `contact.html`, `get-app.html`.

## Verification (2026-10-22)
- `verify_site.py`: "Checked 12 pages, 11 FAQ entries, 4 HowTo steps, 11 sitemap URLs. All checks passed."
- Screenshots: index 1366px (full page) and 375px; plans 1366px.
- Bug found and fixed: header "Get the app" text was invisible on marketing pages because `.site a { color: inherit }`
  out-specified `.nav-cta`. Selectors now `.site-header .nav-cta` (and the two hide rules updated to match).

## Security gate — PASS
Static page; no new scripts beyond existing header/footer; no third-party requests (font self-hosted);
animation disabled under `prefers-reduced-motion`.

## Post-task review — APPROVED with notes
- Contact and Get the app pages still use full-width dark heroes; a follow-up could make them light for full consistency.
- Example content (VFD reset, pump torque) is illustrative, same as before.
