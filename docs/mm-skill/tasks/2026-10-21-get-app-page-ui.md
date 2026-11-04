# Fix get-app.html page UI

- Flow: BUG_FIX
- Status: implemented, not committed

## Outcome
- `get-app.html` rebuilt as described; real store links; redirect no longer checks for `REPLACE_ME`.
- `common.css`: `.page-get-app` hides the header "Get the app" button.
- `index.html` step 4 skipped: the user had already put real links there.
- Verified with headless Chrome at 1440px, 800px and 375px (375px in an iframe: scrollWidth = clientWidth = 375, no horizontal scroll). Footer sits at the bottom at all three.
- Security: static page, no input handling; external links use `rel="noopener"`; redirect targets are only the two hard-coded store URLs.
- Date: 2026-10-21

## Done =
`get-app.html` looks like the rest of the site: the footer sits at the bottom of the window with no grey band under it, the page has the same visual language as the home page's "Get the app" section, and it works at desktop and phone widths.

## Root cause (what is wrong today)
1. **Grey band under the footer.** The page is shorter than the window. `body` has the grey `--bg-page` background and nothing pushes the footer down, so the leftover space shows as grey below the footer.
2. **Bare, unbranded content.** The page is only a centred heading, one sentence and two badges in a large empty grey area. It has none of the elements the rest of the site uses (orange kicker, icon, card, the orange glow from the home hero) and no QR code for desktop visitors, who are exactly the people who stay on this page.
3. **Header "Get the app" button points away from the page.** In `header.js` it links to `index.html#get-app`, so clicking it on this page leaves the page.

## Plan
Files: `get-app.html` only (plus one small change in `header.js` / `common.css`, see step 3).

1. Sticky footer: make `body` a full-height flex column and let `main` grow (`min-height: 100vh; display: flex; flex-direction: column;` on body, `flex: 1` on main). Scoped to this page's `<style>` so other pages are unaffected.
2. Rebuild the page content as a centred white card on the grey background, matching the home page style:
   - orange glow in the corner (same as the home hero)
   - phone icon in an orange-tinted circle
   - orange "MOBILE APP" kicker, heading "Get the LiveAccess app", short description
   - the two checklist points used on the home page ("Ask questions in plain language", "Open OEM manuals in the app")
   - App Store + Google Play badges
   - on desktop only: a divider and the QR code with "Scan with your phone to download" (hidden under 600px, since a phone visitor is already on the phone)
3. Header button: on this page, hide the header's "Get the app" button (they are already there). Done by adding a body class `page-get-app` and one rule in `common.css`: `.page-get-app .getapp-btn { display: none; }` + restore `margin-left: auto` on the Contact button. Alternative considered: change the link in `header.js` to `get-app.html` on every page; rejected because the home page section with the QR is the better target from other pages.
4. Store links: replace the `REPLACE_ME` placeholders with the real links already in `index.html`:
   - App Store: `https://apps.apple.com/app/liveaccess-24-7/id6790754198`
   - Google Play: `https://play.google.com/store/apps/details?id=com.liveaccess.app`
   This also turns on the phone auto-redirect. Same replacement in the home page "Get the app" section (`index.html` lines 470 and 473).
5. Verify in the browser at desktop (1440px) and phone (375px) widths; check that the footer sits at the bottom and nothing overflows horizontally.

## Not in scope
- Committing / deploying (will stop before commit).
- The server returning 500 instead of 404 for missing pages (hosting config).
