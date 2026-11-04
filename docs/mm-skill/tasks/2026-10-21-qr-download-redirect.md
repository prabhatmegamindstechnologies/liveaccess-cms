# Smart QR redirect via download.html

- Flow: FEATURE
- Status: implemented, not committed. User confirmed on a real phone (local network) that the scan opened the store; local test QR and its page script then removed, pages show only the live QR.

## Outcome
- Created `download.html`, `tools/make-qr.py`; regenerated `app-qr.svg` (decoded: `https://liveaccess.ai/download.html`).
- `get-app.html`: redirect script removed; QR alt text updated (also in `index.html`).
- Store URLs kept on the badge links instead of a separate `STORE_URLS` object, so the redirect and the visible fallback links cannot drift apart.
- User asked for a local phone test: test QR `http://192.168.1.2:5500/download.html` written to the session scratchpad only, never to `app-qr.svg` (script refuses).
- Tests: user-agent harness (Android, iPhone, iPad old UA, iPadOS desktop UA, Mac, Windows) all correct; both QR files decoded with zxing-cpp; screenshots of `download.html` and `get-app.html` at 1280px; no console messages.
- Security: no input handling; redirect targets are only the two hard-coded store URLs, so no open redirect or loop.
- Date: 2026-10-21

## Done =
Both QR codes (home page and `get-app.html`) encode `https://liveaccess.ai/download.html`. That page sends Android to Google Play, iPhone/iPad to the App Store, and shows both store links on desktop or without JavaScript. `get-app.html` keeps its current design and no longer redirects.

## Decisions (from brainstorm)
- `get-app.html` stops redirecting phones; it becomes a normal landing page. (user: yes)
- Home page QR must also send phones to the right store. Both QRs use the same image file, `app-qr.svg`, so pointing that one file at `download.html` covers both. (user: home QR should go to the store)
- Public URL: `https://liveaccess.ai/download.html` (no answer given; default kept, works with the current FTP hosting with no server config).
- QR generation: static SVG generated once from one setting by a small script, not drawn in the browser. Reason: the encoded URL never changes (store links change inside `download.html`, not in the QR), so browser-side generation would add ~20 KB of JavaScript and a failure point for no benefit, and a static image also works with JavaScript off. Rejected: in-browser library (adds a dependency); online QR generators (many make "dynamic" codes that route through their own servers and can expire).

## Real values (found in the repo, not invented)
- Google Play: `https://play.google.com/store/apps/details?id=com.liveaccess.app`
- App Store: `https://apps.apple.com/app/liveaccess-24-7/id6790754198`
- QR target: `https://liveaccess.ai/download.html`

## Plan
1. **`download.html`** (new, site root):
   - One `STORE_URLS` config object at the top of the script holding the two store URLs.
   - Detection: Android by `/Android/`; iOS by `/iPhone|iPad|iPod/` plus iPadOS that reports as a Mac (`Macintosh` + `navigator.maxTouchPoints > 1`).
   - Phones: show "Opening the App Store / Google Play…" and call `window.location.replace(url)`.
   - Desktop / other: show the card with both badges (same look as `get-app.html`, shared `common.css`, header and footer).
   - Fallback links are real `<a href>` tags in the HTML, so they work if the redirect fails or JavaScript is off.
   - No loop possible: the page only ever redirects to the two external store URLs, never to itself or another site page.
   - `<meta name="robots" content="noindex">` so search engines don't list it.
2. **`get-app.html`**: remove the redirect script; keep everything else as is (layout, badges, QR image).
3. **`tools/make-qr.py`** (new): one `DOWNLOAD_URL` constant; writes `app-qr.svg` using the `segno` library with the same size, colours and border as today. The `tools/` folder is not copied by the deploy workflow, so it never goes live.
4. **`app-qr.svg`**: regenerate with the script so it encodes `https://liveaccess.ai/download.html`; update the `alt` text in `index.html` and `get-app.html` to match.
5. **Wiki**: update `mobile-app-links.md` (where links live, how to regenerate the QR).

## Testing
- Run `download.html` in headless Chrome with Android, iPhone, iPad (old and iPadOS-desktop style) and desktop user agents; record where each one ends up.
- Check the fallback links' `href` values and that the page shows them with JavaScript disabled.
- Decode the new `app-qr.svg` with a QR reader to confirm it holds exactly `https://liveaccess.ai/download.html`.
- Screenshot `get-app.html` and the home page section before/after to confirm no visual change.
- Check the browser console for errors.
- Not possible from here: scanning with a real phone camera after deploy. You will need to do that on one Android phone and one iPhone.

## Not in scope
- Committing / deploying.
- A shorter `/download` URL (needs server rewrite config).
