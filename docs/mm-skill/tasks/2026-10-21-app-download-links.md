# Add TPS mobile app download links to liveaccess.ai

- **Date:** 2026-10-21
- **Flow:** FEATURE
- **Status:** Built and verified locally. Waiting on real store URLs before deploy.
- **Requested by:** Akash Kathiriya (Teams, 2026-10-21 11:14)

## Goal

Add Google Play and App Store download links for the LiveAccess mobile app to the site.

**Done =** the hero shows both store badges, a new "Get the app" section with a QR code sits before the footer, the header has a "Get the app" button (icon only on phones), `get-app.html` sends each phone to its store, and all new files reach the live server through `deploy.yml`.

## Brainstorm (confirmed)

| Question | Decision |
|---|---|
| Placements | A (hero badges), C (Get the app section + QR), B (header button). Not D, E or F. |
| Store URLs | Static, hard-coded in HTML. No `.env` and no build step. `REPLACE_ME` placeholders until real URLs arrive. |
| Badge artwork | Claude adds the official Apple and Google badges. |
| Header on phones | Phone icon only at small widths. |
| QR target | `https://liveaccess.ai/get-app.html`, a new shareable page that redirects by device. |
| Section copy | Draft below. Edit it here if TPS wants different wording. |

Rejected: `.env` with a build script, and a runtime `config.js`. The user said neither is needed.

## Plan

### 1. Badge and QR assets (repo root, next to logo.png)
- `badge-app-store.svg`: official "Download on the App Store" black badge (Apple Marketing Tools).
- `badge-google-play.png`: official "Get it on Google Play" badge (Google Play badge page).
- `app-qr.svg`: QR code for `https://liveaccess.ai/get-app.html`, generated once with a local tool. Static file, no runtime library.
- If the official artwork can't be downloaded here, stop and ask. Don't redraw it.

### 2. `get-app.html` (new page, shareable link)
- Script checks the user agent: iPhone/iPad goes to the App Store URL, Android goes to the Play URL.
- Computers and other devices see a simple page in site style: header, both badges, footer.
- `<noscript>` fallback shows the badges.
- Store URLs are set in one `const` at the top of its script.

### 3. A: hero badges (`index.html`, after hero `<p>` ~line 261)
- `<div class="hero-actions">` with two badge links (`target="_blank" rel="noopener"`, descriptive `alt`).
- Line under the badges: "Available for iPhone, iPad and Android."
- Badges 40px high, same height for both.

### 4. C: "Get the app" section (`index.html`, before footer script ~line 401)
- `<section class="get-app" id="get-app">`, dark background using `--dark-card`.
- Copy (draft, edit here):
  - Label: "Mobile app"
  - Heading: "Take LiveAccess onto the plant floor"
  - Text: "Search manuals and get answers from your phone, right at the machine."
  - Checklist: "Ask questions in plain language" / "Open OEM manuals in the app"
- Both badges, plus a QR card ("Scan with your phone to download") on the right.
- QR card hidden below 600px, where the badges can be tapped.

### 5. B: header button (`header.js`, `common.css`)
- Outlined "Get the app" button before Contact Us, linking to `index.html#get-app`.
- Below 600px: label hidden, phone icon kept, `aria-label` keeps it accessible.
- Check the 380px breakpoint still fits logo + 2 buttons.

### 6. Deploy and cache
- `deploy.yml` line 18: add `*.svg` to the copy list (png and html are already covered).
- Bump `?v=` on `header.js` and `common.css` in all 5 HTML pages.

### 7. Verify
- Serve locally and check index.html at 1280px, 600px and 380px widths.
- Check `get-app.html` on a desktop user agent and on simulated iOS and Android user agents.
- Check all new files return 200 from the local server.
- Simulate the deploy copy step and confirm the svg and png files are included.

## Changes from plan
- Header button (B) widths: full label above 700px, icon only from 521 to 700px, hidden at 520px and below. Even before this change, the header was too tight for a third item at phone widths (320–480px): with the icon added, Contact Us wrapped or was cut off. At 520px and below the header is now identical to the original.
- Google badge PNG cropped to its visible area (564×168) so it lines up with Apple's 40px SVG.
- Apple badge came from developer.apple.com (tools.applemarketingtools.com did not resolve).
- `get-app.html`: no `<noscript>` block. The badges are plain HTML links, so they already show without JavaScript. The redirect reads each store URL from its badge link (`data-store`) instead of a separate `const`, so each URL is written once in the file.
- The "icon only on phones" decision (Goal and Brainstorm table) is superseded by the header widths above.

## Security Gate
Status: PASSED
- ✅ No new user inputs, endpoints or project dependencies
- ✅ Redirect targets come from the page's own links, not the URL, so it can't be used as an open redirect
- ✅ No secrets in diff; all `target="_blank"` links have `rel="noopener"`
- ✅ Deployed SVGs contain no scripts, event handlers or external references
- 🟡 `REPLACE_ME` store URLs must be replaced before go-live

## Code Review
Status: APPROVED
- ✅ A, B, C built as planned; official badge artwork; alt text and focus styles
- ✅ No dead CSS; breakpoints checked against the original header
- 🟡 SUGGESTION: store URLs are in 3 places; search `REPLACE_ME`
- 🟡 Header button hidden at 520px and below on every page

## Verification (2026-10-21)
- Local server: all pages and new assets return 200 with correct content types.
- Deploy dry run: `cp` now includes `app-qr.svg`, `badge-app-store.svg`, `badge-google-play.png`, `get-app.html`.
- Screenshots (headless Edge, real-width iframes): index.html at 1280 / 380px; header at 320, 360, 375, 414, 480, 481, 520, 521, 540, 600, 601, 650, 700, 701, 768px compared with the original from HEAD.
- Redirect test (node): iPhone, iPad and Android go to their store; Mac and Windows stay. With `REPLACE_ME`, every device stays on the page.

## Open items
- Real Play Store and App Store URLs from Akash. Search for `REPLACE_ME` in `index.html` and `get-app.html` to swap them in.

## Files touched
`index.html`, `header.js`, `common.css`, `get-app.html` (new), `badge-app-store.svg` (new), `badge-google-play.png` (new), `app-qr.svg` (new), `.github/workflows/deploy.yml`, `?v=` bumps in `privacy-policy.html`, `terms-and-condition.html`, `delete-account.html`.
