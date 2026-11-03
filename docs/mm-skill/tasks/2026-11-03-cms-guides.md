# CMS: Troubleshooting guides editor

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-03, Prabhat ("let implement that functionality" on `/la-studio/guides`)
- Branch: feature/cms

## Request
Replace the coming-soon page at `/la-studio/guides` with a working editor for troubleshooting guide articles:
list, edit, create new (with slug), content blocks, SEO.

## What exists today (checked 2026-11-03)
- 6 guides imported into `articles` (type `guide`, status `published`, `area_slug`, `published_date`, `summary`,
  12 blocks each, SEO columns, `version`). Block types in use: heading, paragraph, list, callout (safety +
  disclaimer).
- `packages/shared/src/blocks.ts`: `importBlocks` (article markup → blocks) and `blockHtml` (blocks → the site's
  markup). `blockHtml` also knows image / table / quote, but the site's CSS has no styles for those
  (`cms-img`, `cms-table`, `cms-quote` don't exist in `common.css`).
- Guide page layout (`guide-*.html`, ~11 KB): crumbs (Home / Guides / title), `h1`, `p.lede` (summary), byline
  ("By LiveAccess team, TPS · Published <time> · <area link>"), `article.article` with the blocks, CTA band,
  JSON-LD in the head. Guides are also listed as cards on `guides.html` and on their process area page.
- `articles` has one `blocks` column and no copy of what is live; `status` is draft | published.
- Publish centre (writes the site files) is not built yet. Media library is not built yet.

## Brainstorm (answers 2026-11-03, Prabhat)
1. Scope: list with status; edit the 6; "+ New guide" starts as Draft; delete only never-published drafts
   (taking a live guide down belongs to the Publish centre). → ok
2. Blocks: only what the site already styles: heading H2/H3, paragraph, bullet/numbered list, safety note,
   disclaimer note. Images with the Media library; tables/quotes later (would need new site CSS). → ok
3. Slug: no answer → recommendation **(a)**: generated from the title, editable while never published, then locked.
4. Fields: title, summary (lede + card text), process area (one of 8), published date; fixed byline
   "By LiveAccess team, TPS"; SEO tab (meta title, description, noindex). → ok
5. Saving: **(a) auto-save** like the page editor.
6. Preview of the real guide layout (from an existing guide page, no scripts) + keep a copy of what's live so the
   list shows "Unpublished changes". → ok

## Plan
- [x] 1. **Shared** `packages/shared/src/guides.ts` (tests first):
      - `renderGuidePage(templateHtml, guide, areaName)`: puts title, summary, date, area, blocks and SEO into a
        guide page's existing markup (`<title>`, meta description, og/twitter tags, canonical, JSON-LD headline /
        description / dates / url, crumbs, `h1`, `p.lede`, byline `<time>` + area link, `article.article`).
        Test: each of the 6 real guide files rendered with its own data gives back the file byte-for-byte
        (layout lock), and changed data lands only in those places, escaped.
      - `validateGuide()`: title 1–120, summary 1–300, area = one of the 8, date YYYY-MM-DD, slug
        `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 80 and unique per type, 1–200 blocks of the 5 allowed types (inline HTML through
        `sanitizeInline`, plain text elsewhere, heading level 2/3, list 1–50 items), SEO lengths like pages.
      - `slugify(title)`.
- [x] 2. **Database**: migration adds `articles.published` (jsonb: title, summary, area, date, blocks, SEO, slug)
      and `articles.updated_by`; backfilled from the current rows (all 6 are live). Draft = the normal columns.
- [x] 3. **API** `/la-studio/api/guides` (login + CSRF, save limit), tests first:
      - `GET /` → list (title, slug, area, status, unpublished changes, last edited by/at).
      - `POST /` `{ title }` → new Draft with a unique slug from the title, starter blocks; returns it.
      - `GET /:id` → guide + the page template (an existing guide file, scripts kept out on the client) +
        area list. `PUT /:id` `{ baseVersion, …fields }` → validate, 409 "changed by X", slug change refused once
        published, revision every 10 min like pages, audit. `DELETE /:id` → only never-published drafts (else 409).
      - Live site files and other content untouched.
- [x] 4. **Admin**: `/la-studio/guides` list (status chip, "Unpublished changes", "+ New guide") and
      `/la-studio/guides/:id` editor: Content tab (fields + block list: add block of a type, edit, ↑ ↓ ✕), SEO tab,
      live preview of the real guide layout on the right (sandboxed, no scripts), auto-save with the existing
      auto-saver (saved status, conflict banner, flush on leave), delete for drafts.
- [x] 5. Verify: tests, typecheck, build, headless Edge (edit an existing guide → preview + saved + reload; new guide
      → slug from title → edit slug → blocks → saved; delete draft; published guide can't change slug or be
      deleted; conflict) and a check that site files and pages are unchanged.
- [x] Security gate · [x] Code review · [x] Wiki update (`cms.md`: guides API, blocks, slugs)

**Not in this task:** publishing (writing `guide-*.html`, updating `guides.html`, area pages, sitemap, llms.txt —
Publish centre); images in guides (Media library); process areas editor (same pattern, next).

## Log
- 2026-11-03: plan approved ("yes"). `guides.ts` tests first (RED: module missing → GREEN).
- `renderGuidePage` rebuilds all 6 guide pages byte-for-byte (apart from `&#x27;` vs `'` inside the article in
  3 pages, which browsers show the same). Found by the test: a heading sits right above its block, other blocks are
  separated by a blank line.
- Validation has a `partial` mode for auto-save (unfinished drafts save; types, limits, slug format and sanitising
  still apply). Completeness ("Before publishing" list) is checked in the browser with the same function.
- Migration `0003_articles_published.sql`: `articles.published` (live copy, backfilled for the 14 imported
  articles) + `articles.updated_by`. Importer sets `published` too.
- API `cms/api/guides/routes.ts`; guide saves may be up to 512 KB (other requests 64 KB).
- Admin: `GuidesList`, `GuideEditor`, `components/BlockEditor.tsx`; sidebar highlights sub-pages (`/guides/12`).
  A 422 on auto-save shows field errors and saves again on the next change (409 still stops with a banner).

## Verification
- Tests: shared 68/68 (guides 8), cms 94/94 (guides API 7). Typecheck clean, admin build OK.
- Headless Edge: list shows 6 guides "Published", sidebar highlights Guides; Evaporator fouling opens with 12 blocks,
  slug read-only, preview h1 = title, 0 scripts in preview, no "Before publishing" items; edit title + add paragraph
  with <strong> → "Saved", "Unpublished changes", preview shows the new title and paragraph; reload keeps 13 blocks;
  save by someone else → "changed by" banner. New guide "Pump cavitation: quick checks" → slug
  `pump-cavitation-quick-checks`, Draft, 10 starter blocks, 7 items before publishing, preview shows it; slug edited,
  summary + area → saved, preview byline "Liquid processing"; slug `evaporator-fouling` → "Another guide already uses
  this address." then fixed → saved; Delete draft → back to 6 guides.
- DB: pages unchanged; the edited guide restored from a backup afterwards (all 6 at version 1); test user removed.
  Site guide files unchanged (git status clean).

## Security Gate
Status: PASSED after fixes (checklist + security-auditor agent, 2026-11-03)
Findings:
- ✅ Escaping in `renderGuidePage` (HTML text/attributes, JSON-LD with `<` as `<`); replacements are functions;
  exactly-one-match checks fail closed; slug regex keeps file names safe; template picked from a filtered listing;
  explicit field list on PUT (no mass assignment); ids `^\d{1,9}$`; preview sandbox without scripts; auth + CSRF.
- 🟡→✅ Editor sanitised inside the admin page's `document` (innerHTML could fire `<img onerror>` if raw HTML ever
  reached the DB) → inert `document.implementation.createHTMLDocument("")`.
- 🟡→✅ `tagDepth` regex was quadratic on unclosed tags (~1 s for 60 KB) → `[^<>]` (linear); timing test added.
  Plus a 100,000-character cap on a guide's inline text (test).
- 🟡→✅ Delete checked "never published" outside the transaction → re-checked under `FOR UPDATE` inside it.
- ✅ Duplicate-slug race → unique index error returned as 422 "already uses this address"; numbered slugs stay valid
  (≤ 80, no `--`); create uses `on conflict do nothing`.
- ✅ Hidden (control/bidi) characters refused in block text (test).
- 🟡 For Publish: run the full `validateGuide` again before writing files (don't trust the DB).

## Code Review
Status: APPROVED
Notes:
- ✅ Scope as agreed: list, edit 6, new draft, delete drafts only, 5 block types, fields, SEO tab, auto-save, preview,
  unpublished changes; slug locked once live.
- ✅ Layout lock proven: all 6 guide pages rebuild byte-for-byte from their data.
- ✅ Tests: shared 70 (guides 10, sanitize timing 1), cms 95 (guides API 8); E2E twice; pages and files unchanged.
- 🟡 SUGGESTION: the process areas editor can reuse `BlockEditor`, the validation and the API pattern.
- 🟡 SUGGESTION: guide list doesn't paginate (fine for dozens of guides).
