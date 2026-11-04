# Remove Plans page and tier wording, About-page cleanup

- **Flow:** SMALL_TASK
- **Date:** 2026-10-22
- **Branch:** feature/clarity-seo-redesign
- **Status:** Plan — awaiting approval

## Request
1. No Plans menu item and no Plans page.
2. About: remove the locations list.
3. "50 years" → "30 years".
4. Remove Tier 1 / Tier 2 wording from the entire website.

## Done =
No Plans page or nav item; no "Tier 1/Tier 2" anywhere on the marketing pages; About shows no office locations;
About says 30 years; no broken links; sitemap, llms.txt and structured data consistent; checks pass.

## Changes

### 1. Plans page and menu
- Delete `plans.html`.
- `header.js`: remove "Plans" from the nav → How it works · Features · About · Contact · [Get the app].
- `footer.js`: remove "Plans" link.
- `sitemap.xml`, `llms.txt`: remove the Plans entry.
- Re-point links that went to `plans.html`:
  - `index.html` Get-the-app box "Ask us about Tier 2" → "Questions? Contact us" → `contact.html`
  - `features.html` "Compare plans →" → removed
  - `about.html` CTA button "Compare plans" → "See features" → `features.html`

### 2. Tier wording (marketing pages + llms.txt)
| Where | Now | Change to |
|---|---|---|
| `index.html` feature tile | tag "TPS clients" | remove tag |
| `index.html` step 4 | "TPS clients" label | remove label |
| `how-it-works.html` step 4 | "Video call: Tier 2 · TPS clients" | remove label |
| `features.html` 2 tiles | tag "Tier 2" | remove tags; drop the "Features tagged Tier 2…" line |
| `features.html` JSON-LD featureList | "(Tier 2)" ×2 | remove "(Tier 2)" |
| `faq.html` (visible + JSON-LD) | "Is LiveAccess free?" mentions tiers; "Tier 1 vs Tier 2" question; "Tier 2 users tap…" | rewrite free answer without tiers; **delete** the Tier 1 vs Tier 2 question; "Tap the video icon to call…" |
| `faq.html` meta description | "…Tier 1 vs Tier 2…" | remove |
| `about.html` CTA | "Ask about Tier 2 access for your team." | "Ask us about LiveAccess for your team." |
| `contact.html` lede, meta, OG, dropdown | "Tier 2 access…" | "Access for my team" wording |
| `llms.txt` | Tier 1 / Tier 2 lines, "TPS clients can also video-call…" | one feature list, no tiers |

### 3. About page
- Remove the "Where we are / Two offices" section (both addresses) and the "2 offices — Singapore & Denmark" fact card.
- "50 years" → "30 years" (fact card + meta description). Meta description also drops "offices in Singapore and Denmark".
- About JSON-LD: remove addresses and the TPS Europe ApS sub-organization (structured data should match visible content).

### 4. Logo jumps to the old page
- **Symptom (user):** clicking the header logo opens the old homepage design.
- **Cause (most likely, not verifiable from here):** the logo links to `index.html`, but the site is opened at `/`.
  The browser caches `/` and `/index.html` as two different pages and is still holding an old copy of `/index.html`.
- **Fix:** logo (`header.js`) and all "Home" breadcrumbs (7 pages) → `href="./"` (site root). Same page as `/`,
  matches the canonical `https://liveaccess.ai/`, and avoids a duplicate `index.html` URL for SEO.

### 5. Versions
- Bump `header.js` / `footer.js` to `?v=2.1.2` on all pages (nav + logo link changed).

## Answers (2026-10-22)
1. Video call / AI-enhanced search / plant data shown as features with no "clients only" label — **default (yes)**.
2. Contact page **keeps** its office addresses.
3. Legal pages (Terms, Privacy) **not changed** — default. Terms §3 and Privacy §1 still mention "service tier".
4. FAQ "Who makes LiveAccess?" — **remove** "with offices in Singapore (TPS Pte Ltd) and Denmark (TPS Europe ApS)"
   (visible text + JSON-LD). Same phrase removed from `llms.txt` maker line.
5. Logo — fix the link (section 4).

## Verification
- `verify_site.py` (links incl. no `plans.html` references, JSON-LD parse, FAQ JSON = visible text, sitemap).
- `grep -i tier` over marketing pages + llms.txt → no matches.
- Screenshot About + homepage.

## Done (2026-10-22)
All sections 1–5 applied as planned. `plans.html` deleted. `llms.txt` rewritten (one feature list, no tiers, no
office locations, no Plans link). Also removed now-unused CSS (`.step .tier`, `.step .t2`, `.tile.full .tag`,
`.office*`). Index/Contact JSON-LD addresses kept (Contact still shows them).

## Verification
- `verify_site.py`: "Checked 11 pages, 10 FAQ entries, 4 HowTo steps, 10 sitemap URLs. All checks passed."
- grep: no `plans.html` / "Plans" links; no "tier" / "TPS clients" / "special access" on marketing pages or llms.txt;
  no "50 years" or office addresses on About/FAQ; logo + 6 breadcrumbs use `href="./"`.
- Legal pages still contain "tier" once each (intentionally unchanged, answer 3).
- Screenshot About at 1366px: nav without Plans, "30 years", offices section gone.

## Security gate — PASS (content/CSS removal, one deleted page, no new scripts)
## Post-task review — APPROVED
- Logo fix cause is a likely browser-cache explanation; user should confirm by clicking the logo after a hard refresh.
