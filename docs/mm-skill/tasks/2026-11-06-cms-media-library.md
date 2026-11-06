# CMS: Media library

- Flow: FEATURE
- Status: done locally. Uploads can't work on Vercel until a Blob driver exists (see Security Gate).
- Requested: 2026-11-06, Prabhat ("let implement this page", with a screenshot of the Media library "coming soon" screen)
- Approved: 2026-11-06, Prabhat ("yes")
- Branch: feature/cms

## Done =
The Media library page lets signed-in users upload images, add alt text and reuse them across the site, replacing the "coming soon" screen.

## What exists today (checked 2026-11-06)
- `/media` is a `SOON` entry in `cms/admin/src/main.tsx`, shown by `ComingSoon.tsx`.
- `media` table exists (`cms/db/schema.ts:97`): `fileName`, `storageKey`, `mime`, `width`, `height`, `bytes`, `altText`, `createdBy`, `createdAt`. No API or screen uses it.
  `pages.ogMediaId` already points at media.
- `packages/shared/src/blocks.ts`: an `image` block with `mediaId`, `position`, `alt`, `caption`; `blockHtml` takes a `mediaSrc` resolver.
- Waiting for this feature: "Change image" in `FieldList.tsx:49` (disabled), the share image in `SeoPanel.tsx:41`, and the Jodit image button (agreed 2026-11-05: add after the library).
- `cms/publish/build-site.ts:210` copies `images/` into the build, and nothing copies uploaded media yet.
- `images/` holds 4 WebP files (0.1 MB). `sharp` isn't installed.
- From the original plan (`2026-10-30-custom-admin-panel.md`): Vercel Blob behind a storage adapter with a local driver; JPG, PNG and WebP only, max 10 MB, re-encoded by sharp, random file names;
  alt text required; library screen has upload, alt text, usage and replace; the site never loads media from storage (Publish copies it into the site).

## Brainstorm
Answers (2026-11-06, Prabhat):
- Scope: **1(b)** library page, plus picking images in the guide and area Image block, the Paragraph editor and "Change image" on pages, plus Publish copying the files. The SEO share image is left out.
- Storage: **2(a)** local folder behind an adapter; a Vercel Blob driver comes with hosting (Day 6).
- Processing: **3(a)** re-encode with `sharp`.
- Existing site images: **4(a)** left alone; the library starts empty.
- Permissions: **5(a)** Editors and Super Admins can upload, edit, replace and delete. The page shows usage, and delete is refused while an image is in use.

## Plan

### How it will work
1. **Upload:** `POST /media` takes the file and alt text. `sharp` checks the real format (JPEG, PNG or WebP, whatever the name says), applies the photo's rotation, shrinks anything wider than
   2400 px, removes metadata, and saves it as WebP under a random name (`<32 hex>.webp`). 10 MB maximum, 50 megapixels maximum.
2. **Page addresses:** content stores `images/cms/<key>.webp`, the same relative form as the site's own images. Publish copies only the files in use to that path, so the live site never loads from storage.
3. **Showing images in the admin:** `<img>` can't send a Bearer token, so `GET /media/files/<key>` is public (see Alternatives). The admin rewrites `images/cms/...` to it in thumbnails, previews and the Paragraph editor.
4. **Replace:** new file, same key, so every page using it updates and nothing needs re-picking. `?v=` on admin addresses stops a stale thumbnail.
5. **Usage and delete:** usage is worked out by scanning `pages.html`, `pages.published_html`, and article `blocks` and `published`. That covers both draft and live, so a live image can't be deleted. Delete answers 409 and names the pages.

### Steps
- [x] **1. Storage and data:** add `sharp`; `cms/api/media/storage.ts` (`put`, `get`, `remove`) with a local driver in `MEDIA_ROOT` (default `.media/`, git-ignored); migration adds `updated_at` and a unique index on `storage_key`.
- [x] **2. API** (`cms/api/media/routes.ts`): `GET /media?q&page` (48 per page, with usage), `POST /media`, `PATCH /media/:id` (alt text), `POST /media/:id/replace`, `DELETE /media/:id`, public `GET /media/files/:key`.
  Own body limit in `app.ts`, because everything else is capped at 64 KB. 30 uploads a minute per user. Audit actions `media_uploaded`, `media_edited`, `media_replaced`, `media_deleted`, added to `CONTENT_ACTIONS`, `GROUPS` and `admin/src/lib/audit.ts`.
- [x] **3. Library page** (`screens/MediaLibrary.tsx`, replaces the `SOON` entry): grid, search, drag or choose to upload, alt text required, details panel with usage, replace and delete. `api()` gets a form-upload option.
- [x] **4. Picker** (`components/MediaPicker.tsx`): one modal to choose or upload, used by steps 5 to 7.
- [x] **5. Guides and areas:** "Image" in `BlockEditor.tsx` (picture, position, alt, caption); image branch in `validateGuide`, which has none today, so a save would refuse the block (alt and picture required for Publish, optional in auto-save);
  pass `mediaSrc` through `renderGuidePage` and `renderAreaPage`; add the `.cms-img` CSS to `common.css`, which doesn't have it yet.
- [x] **6. Paragraph editor:** image button in `RichTextEditor.tsx`; `sanitizeRich` allows `img` with `alt`, and only when `src` is exactly `images/cms/<32 hex>.webp`. `isRichParagraph` treats it as rich, so plain paragraphs stay byte-for-byte the same.
- [x] **7. Pages and Publish:** "Change image" in `FieldList.tsx` through a new `setImageSrc` in `fields.ts` (sets `src` and `alt`; updates `width` and `height` only if the tag has them). `build-site.ts` copies used files and warns about a missing one.
- [x] Security gate — PASSED for local use
- [x] Code review — APPROVED
- [x] Verification — PASSED
- [x] Wiki (`cms.md`) — updated

### Callers and contracts
- `sanitizeRich` / `cleanParagraph` / `isRichParagraph` (`sanitize.ts`): used by `blocks.ts`, `RichTextEditor.tsx` and validation. The change only adds an allowed tag; no existing content has `img`, so existing output stays the same. All 6 guides and 8 areas must still rebuild byte-for-byte.
- `blockHtml(b, doc, mediaSrc)`: already takes `mediaSrc`; `guides.ts:36` and the area renderer don't pass it. `renderGuidePage` and `renderAreaPage` gain an optional last argument, so existing callers keep working
  (`build-site.ts:162`, `:178`, `GuideEditor.tsx:106`, `AreaEditor.tsx:62`, tests).
- `api()`: gains a `form` option. `json` callers don't change. The 401 retry must resend the same `FormData`.
- `checkPageHtml` (`guard.ts`): no change needed. It already allows a new `src`, and `data:` stays refused. A test will confirm it.
- No site page uses `<picture>` or `srcset` (checked), so changing `src` alone is enough.

### Alternatives
- Picked: public `GET /media/files/:key`, with unguessable names, `nosniff`, a `sandbox` CSP, and no directory listing. Cost: anyone with the exact link can see an image that isn't published yet.
  Rejected: fetching each image with the Bearer token into a blob URL, which doesn't work inside the preview iframe and is slow in a grid.
- Picked: save everything as WebP. One format, small files, and transparency survives. Rejected: keeping the original format, which means more code paths for no gain on this site.
- Picked: same key on replace. Rejected: a new key, which would mean rewriting every page and article that uses the image.
- Picked: work out usage by scanning. There are only tens of pages, and it can't drift. Rejected: a usage table, which every save path would have to keep correct.
- Picked: storage in `cms/api/media/`, server only. Rejected: `packages/shared/storage.ts` from the original plan, because the browser never needs it.
- Picked: no `caption` or `variants` columns. The caption lives on the block, and one 2400 px file is enough for now. Rejected: responsive sizes, which can come later without changing content.

### Behaviour changes
- **`pnpm db:migrate` is needed** after pulling this, and `pnpm install` for `sharp`.
- `common.css` gains `.cms-img` rules. It's a live site file, so they reach the site on the next deploy of `main`; nothing uses them until an image block is published.
- New optional env var `MEDIA_ROOT`. The local driver can't work on Vercel, so **production uploads need the Blob driver (Day 6)**.
- I'm guessing, please verify: Vercel limits a function's request body to about 4.5 MB, which is below the 10 MB limit. If so, Day 6 needs direct-to-Blob uploads.

### Tests (written first)
- Upload: JPEG, PNG and WebP are saved as WebP with EXIF removed and the rotation applied; a large image is shrunk; refused: a renamed text file, SVG, GIF, an empty file, over 10 MB, over 50 megapixels, no alt text, no token.
- Files: the public route serves a real key with `nosniff` and `sandbox`; a wrong or `..` key gets 404.
- Usage and delete: an image used in a draft page, a published page, a block, a paragraph or a live-only copy can't be deleted, and the 409 names the page; an unused one can, and its file goes too.
- Replace keeps the key and the id. Editors may do everything. Audit entries contain no file paths.
- `sanitizeRich`: keeps an exact `images/cms/` address; removes external, `data:`, `..` and `onerror` forms. Guides and areas still rebuild byte-for-byte.
- `validateGuide`: partial allows an empty image block; full needs picture and alt.
- Build: used files are copied, unused ones aren't, a missing file warns.
- Browser: upload, edit alt text, pick in a guide, a paragraph and a page, see the image in each preview, build the site, and open the page on port 4000.

### Rollback
`git revert <commit>` for the code. The migration only adds a column and an index, so it's safe to leave in place. Files in `.media/` are separate from the repo.
Roll back if a guide or area stops rebuilding byte-for-byte, or `pnpm test` can't be made green.

## What changed from the plan
- Media audit actions are in the Audit log's Content group but not `CONTENT_ACTIONS`, because that list feeds the Dashboard, which is only for pages, guides and areas.
- "Change image" keeps the tag's `width` and adjusts `height`; the plan said it would update both. A 2400 px width would have broken the layout.
- `PageEditor` and `RichTextEditor` convert addresses with `fromAdmin` when saving, because both read from a live DOM that shows the API address.
- `cleanParagraph` now keeps an image-only paragraph; it used to empty anything with no text.
- `hasHiddenChars` is now exported from `@liveaccess/shared`.
- Two old tests used `image` as their example of a forbidden block; they now use `quote`, which is still refused.

## Security Gate
Status: PASSED for local use, from my own review of the diff. The independent `security-auditor` agent pass was NOT run: agents are only started when Prabhat asks.
Findings:
- ✅ Inputs: real format checked by decoding, size and pixel limits, alt text and hidden characters checked, file name cleaned. Tests cover a renamed text file, SVG with script, GIF, empty and oversized files.
- ✅ Permissions: all library routes need a token; only `/media/files/:key` is public, by design. Keys are checked against an exact pattern in the route and in the driver, so no path can leave the folder.
- ✅ Stored XSS: every file is re-encoded; `nosniff` and a `sandbox` CSP on delivery; `sanitizeRich` keeps only an exact address and `alt`.
- ✅ Injection: search uses bound parameters with wildcards escaped.
- ✅ Dependencies: `sharp` 0.35.5 added, past the 7-day rule, install scripts still blocked. `pnpm audit --audit-level=high` exit 0.
- ✅ Secrets: none added. `.media/` is git-ignored. Audit entries hold the file name only.
- 🟡 **Blocks production uploads: the local driver can't work on Vercel**, whose function file system isn't writable or kept between runs (from memory, please verify). A Blob driver is needed first.
- 🟡 Vercel's request limit of about 4.5 MB (from memory, please verify) is below the 10 MB limit, so uploads there may need to go direct to Blob.
- 🟡 Unpublished images can be seen by anyone with the exact link (accepted in the plan).
- 🟡 Delete checks usage, then deletes: an image picked in that same moment could go missing. The site build warns about it.
- 🟡 Restoring an old page revision can bring back a deleted image. The site build warns about it.
- 🟡 Existing, unrelated: esbuild 0.18.20 has a moderate dev-server advisory (dev tooling only).

## Code Review
Status: APPROVED, by reading the diff. `code-review-graph` isn't installed, so the graph review wasn't used.
- ✅ Callers from the plan traced; new render arguments are optional, and all 6 guides and 8 areas still rebuild byte-for-byte (shared suite).
- ✅ Tests were written first and cover each new route, the sanitiser, validation, usage, audit and the build.
- 🟡 SUGGESTION: `GET /media` scans content on each call. Fine at tens of pages; revisit if the site grows a lot.
- 🟡 SUGGESTION: one upload at a time, because each image needs its own alt text.

## Verification (2026-11-06, final run)
- `pnpm test`: exit 0. shared 152 passed (133 before), cms 263 passed (227 before).
- `pnpm typecheck`: exit 0. `pnpm build:admin`: exit 0.
- Real admin app in headless Chrome, on throwaway servers with the test database and a scratch media folder: 24 of 24 checks passed, no JavaScript errors. This covers upload, required alt text, editing,
  "Change image", Image block, Paragraph image, saved addresses, reload, usage, delete refused, replace, then the real site build and the built guide opened in the browser.
- NOT exercised: Vercel, a real Blob store, drag and drop, and the Area editor in the browser (it shares `BlockEditor` with guides; its rendering is covered by shared tests).
- `pnpm db:migrate` still has to be run on the local dev database for `0006`.
