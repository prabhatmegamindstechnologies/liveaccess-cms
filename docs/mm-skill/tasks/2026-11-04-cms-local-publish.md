# CMS: Local publish preview

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-04, Prabhat ("let implement publish feature to check static sites locally")
- Branch: feature/cms

## Done =
Clicking **Build preview** in the Publish centre (or running `pnpm build:site`) turns the local drafts into a complete
static site in `.site-preview/`, which can be browsed at `http://localhost:4000`. The repo root, the live site and the
draft/published state in the database stay unchanged.

## Brainstorm (answers 2026-11-04, Prabhat)
1. Start it from: **(a)** a Build preview button in the Publish centre, plus `pnpm build:site` (same build).
2. Clear the "Unpublished changes" badges: **(a)** no, preview only. Nothing in the database changes.
3. First version: **(a)** everything: pages, guides, areas, menus, Site settings, SEO defaults, sitemap, robots, llms,
   redirects.
4. Draft not ready: **(a)** leave it out, finish the build, list what was skipped and why.

Defaults stated and not objected to: git-ignored `.site-preview/`, port 4000, noindex, analytics off, contact form
sends nothing.

## What exists today (checked 2026-11-04)
- Ready to reuse: `renderGuidePage`, `renderAreaPage`, `applyMenus`, `buildSitemap`, `validateGuide`, `validateArea`.
- **Missing, must be written:** nothing applies Site settings or SEO defaults to page HTML. Page SEO edits are saved
  only in the `pages` SEO columns (`PUT /pages/:key`), so the page's `<head>` doesn't contain them yet.
- Not in the database, so copied from the repo root: `404.html`, `error.html`, `download.html`, CSS/JS, fonts, images,
  video, `.htaccess`. `SITE_ROOT` is read only.
- `consent.js` has the GA4 ID hard-coded (`GA_ID`), so a changed ID must be written there too.
- `guides.html` has 6 hand-written guide links, and `process-areas.html` is also a stored page. A new guide or area
  gets its own page but **no card on those listing pages** (see Out of scope).
- The contact form posts to `formspree.io/f/YOUR_FORM_ID`, a placeholder, so it doesn't work on the live site either.
- `pnpm import:site` overwrites `html`/`publishedHtml` on conflict, so re-running it **deletes page drafts**.

## Approach
A build module reads drafts and writes files. A small dev-only server shows them.

**Picked: keep the output identical to what real Publish will write, and apply preview safety in the local server's
response headers.**
- `Content-Security-Policy` blocks Google Analytics/GTM and Formspree (`script-src`, `connect-src`, `form-action`);
  `X-Robots-Tag: noindex` covers indexing. Frames are blocked too: the site has none.
- Rejected: stripping tags from the built HTML. It's simpler to picture, but the preview would then differ from what
  really gets published, and the same build couldn't be reused for real Publish.

**Picked: the preview server runs inside `pnpm dev:api` on a second port**, so the Open site link works with no extra
command. Rejected: a separate `pnpm preview:site` process, one more thing to remember to start.

## Plan
- [x] 1. **Shared transforms** in `packages/shared/src/` (tests first). All leave a page byte-for-byte unchanged when
      the values already match (tested on all 29 pages), HTML-escape values, and throw on unexpected markup:
      - `applyPageSeo(html, seo)`: title, description, robots, canonical, matching og/twitter tags.
      - `applySiteSettings(html, settings)`: site name, footer tagline, store links (each page keeps its own
        `&referrer=utm_…`), public email in mailto links and text, GA4 ID, GTM added alongside when set.
      - `applySeoDefaults(html, defaults)`: fills an empty description / share image, sets the card type.
      - `redirectsHtaccess(list)`: `Redirect 301|302` lines (mod_alias), as the wiki requires.
- [x] 2. **Build** `cms/publish/build-site.ts` (tests first), `buildSite(db, { siteRoot, outDir })`:
      - Reads drafts only, no writes to the database. Menus and settings are applied only if a draft row exists.
      - Pages: `html` + SEO columns + menus + settings + defaults.
      - Guides/areas: full validation. **Never-published draft that fails: left out and reported. Live article whose
        draft fails: its `published` copy is built and reported**, so its address doesn't turn into a 404.
      - An area's guide cards list only guides that were built.
      - Reports links (menus, redirects) that point at a left-out article.
      - `sitemap.xml` from built, non-noindex pages; `robots.txt`/`llms.txt` from drafts, else the root files;
        redirects appended to the copied `.htaccess`; `consent.js` gets the draft GA4 ID.
      - Copies the same file types as `deploy.yml`.
      - Safe writing: builds in `.site-preview.tmp`, swaps it in only on success, so a failed build keeps the last
        good preview. **Refuses any `outDir` that is the site root, or outside the repo.**
- [x] 3. **`.gitignore`**: add `.site-preview/` and `.site-preview.tmp/`.
- [x] 4. **Command** `pnpm build:site` (`cms/scripts/build-site.ts`), prints a summary and skipped items.
- [x] 5. **API** `POST /publish/preview` and `GET /publish/preview` (last result), signed-in, CSRF, one build at a time
      (409), rate limited, audit entry. **Mounted only in development**, like `preview-assets`.
- [x] 6. **Preview server** `cms/api/preview-server.ts`: `127.0.0.1` only, port `PREVIEW_PORT` (default 4000), dev only.
      Same behaviour as `.htaccess` (extensionless → `.html`, `/index.html` → `/`, redirects, real 404 with `404.html`)
      plus the safety headers. Path traversal refused.
- [x] 7. **Admin** Publish centre screen replaces the placeholder: Build preview button, progress, counts, last build
      time, skipped/warnings list with links to the editors, Open site link. Text makes clear that nothing goes live.
- [x] 8. **Docs**: `.env.example` (`PREVIEW_PORT`), wiki `cms.md`.

## Changes from the plan
- GTM isn't written to pages: `consent.js` loads only the first consent-gated tag, so a GTM tag would never run, and fixing
  that changes a live file. The build shows a warning instead. Needs a decision before real Publish.
- Output folder name is fixed (`.site-preview` under `previewRoot`), so an `outDir` can't be passed in at all. The guard
  refuses a site folder that is, or is inside, the output folder.
- Site name is written to `og:site_name` only (what its help text promises).
- Byte-for-byte checks treat `&#x27;` and `'` as equal, like the existing renderer tests (3 guide pages, 4 apostrophes).
- `.gitignore` also needed `!/cms/publish/` and `!/cms/api/publish/` (its `publish/` rule hid the new code).

## Verification
- `pnpm test` and `pnpm typecheck`.
- Baseline test: with no drafts, all 29 built pages equal the current site files byte-for-byte.
- Run against the local database, open the site on port 4000, and confirm a real draft shows (e.g. the Home page edit).
- Confirm `git status` shows no changed root site files, and the Pages list still shows the same badges.
- Mandatory `security-gate` and `post-task-review`.

## Out of scope
- Real Publish: uploading/deploying, marking drafts as published, rollback, publish checks. The build is reusable.
- ~~Automatic cards on the listing pages~~: wrong call, fixed in `2026-11-04-cms-listing-pages.md`.
- Media library images (the Media library isn't built yet).
- `publish_jobs` history: only the last build result is kept, in memory.

## Rollback
All new files plus small edits to `app.ts`, `server.ts`, `main.tsx`, `.gitignore`, `.env.example`, root `package.json`.
Removing them restores today's behaviour. No database migration. Nothing is committed unless Prabhat asks.

## Security Gate
Status: PASSED (independent security-auditor review, no BLOCKING findings for the dev-only preview)
- ✅ Path traversal, hidden files, delete/write targets, redirects, header injection, auth, CSRF, rate limit: clean.
- ✅ Fixed after review: preview also needs the local cookie setting and no `VERCEL`; live copies are re-validated;
  GA4 ID and backslash checks; `/images` redirects refused; safe swap; case-insensitive folder guard; stricter CSP.
- ✅ No new dependencies. `pnpm audit`: 1 moderate, no high or critical. No secrets in the new code.
- 🟡 **Must fix before real Publish (BLOCKING then):** `cms/api/pages/guard.ts` can be bypassed by raw `PUT /pages/:key`
  (`<svg><textarea>` parser difference; `http-equiv` and extra attributes on editable head tags). Reported by the
  auditor, not tried in a browser. In the preview the CSP blocks inline handlers, and the cookie is out of reach.
- 🟡 Before real Publish: re-validate settings and defaults at build time.

## Code Review
Status: APPROVED
- ✅ Does what was requested; baseline test proves no-draft output equals the site (apostrophe rule aside).
- ✅ Errors handled; failed build keeps the last preview; tests for every plan item; fits the existing layers.
- 🟡 SUGGESTION: last build result is in memory, so the screen shows "Not built" after an API restart.

## Verification (2026-11-04)
- `pnpm test`: shared 100 passed, cms 127 passed. `pnpm typecheck` clean. `pnpm build:admin` built.
- `pnpm build:site` on the local database: 12 pages, 6 guides, 8 areas, 1 unfinished draft left out.
- Running preview checked with curl. No root site file changed.
- **Not checked:** the Build preview button in a real browser, and the CSP in a real browser.
