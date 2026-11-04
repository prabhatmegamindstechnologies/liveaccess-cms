# Mobile app links

Added 2026-10-21 (task: `docs/mm-skill/tasks/2026-10-21-app-download-links.md`).

## Where the links are
- Hero badges: `index.html`, under the hero paragraph.
- "Get the app" section: `index.html`, `<section id="get-app">` before the footer. Includes a QR code.
- Header button: `header.js` ("Get the app" → `get-app.html`, changed 2026-10-22). Hidden at 620px and below (the hamburger menu takes its place). Hidden on `get-app.html` and `download.html` (body class `page-get-app`, rule in `common.css`).
- Landing page: `https://liveaccess.ai/get-app.html`. Dark band with both badges and the QR code (QR hidden below 760px). Indexable since 2026-10-22 (`noindex` removed). Does not redirect.
- Other pages link to `get-app.html` from their closing call-to-action bands rather than repeating the badges.
- Redirect page: `https://liveaccess.ai/download.html`. What both QR codes open. Sends iPhone/iPad (including iPadOS that reports as a Mac) to the App Store and Android to Google Play with `location.replace`; desktops see both badges. The redirect reads the store URL from the badge links on that page, so changing a store link there updates both.

## Store URLs
- App Store: `https://apps.apple.com/app/liveaccess-24-7/id6790754198`
- Google Play: `https://play.google.com/store/apps/details?id=com.liveaccess.app`

They appear in 4 places: hero badges and "Get the app" section in `index.html`, `get-app.html`, and `download.html` (whose phone redirect uses its badge links).

## Assets
- `badge-app-store.svg`: official Apple badge (developer.apple.com).
- `badge-google-play.png`: official Google badge, cropped to its visible area so both show at 40px high.
- `app-qr.svg`: QR code for `https://liveaccess.ai/download.html`, used on both the home page and `get-app.html`. It does not need changing when store URLs change.
  - Regenerate: `pip install segno`, then `python tools/make-qr.py`. The URL is the `DOWNLOAD_URL` constant at the top of the script.
  - Phone testing on the local network: `python tools/make-qr.py http://<PC IP>:5500/download.html <some other file>.svg`. The script refuses to write a local or non-https URL into `app-qr.svg`.
  - `tools/` is not copied by the deploy workflow.

Decision: store URLs are hard-coded (no `.env` or build step), as requested by the user.
