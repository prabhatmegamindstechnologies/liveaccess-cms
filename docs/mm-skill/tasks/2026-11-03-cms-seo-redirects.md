# CMS: SEO & redirects section

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-03, Prabhat ("implement the seo & redirects tabs and it functionality", prototype screenshot)
- Branch: feature/cms

## Request
Build `/la-studio/seo` like the prototype's "SEO & redirects" screen: tabs **Redirects**,
**Sitemap, robots & llms.txt**, **Defaults**. Per-page meta title/description stay on each page's SEO tab.

## What exists today (checked 2026-11-03)
- Tables already in the schema: `redirects` (from_path unique, to_path, code 301, is_auto, hits) and
  `settings` (key → jsonb). Both empty.
- `robots.txt` (hand-written: allows all crawlers, lists AI crawlers explicitly, Sitemap line).
- `sitemap.xml` (hand-written, 26 URLs with `lastmod`).
- `llms.txt` (hand-written, 52 lines: key facts, pages, guides, areas).
- `.htaccess` (Apache, current FTP host): 404/error pages, extensionless URL → `.html` 301s, `/index.html` → `/`,
  HSTS, caching. Hosting later moves to Vercel (redirects would then live in `vercel.json`).
- Pages store `noindex` and `canonical` per page (SEO tab, Day 2).
- Publish centre (applies drafts to the live site) is not built yet.

- Titles are written in full per page (no common "… | Site" suffix). Every page has `og:site_name` "LiveAccess",
  `og:image` https://liveaccess.ai/logo.png, `twitter:card` "summary"; no `twitter:site` handle anywhere.
- `sitemap.xml` today = 12 pages + 6 guides + 8 areas = 26 URLs (all `pages` + all published `articles`).

## Brainstorm (answers 2026-11-03, Prabhat)
1. Redirects: add / edit / delete "old → new", 301 or 302; old address starts with `/` and isn't an existing page;
   new = site page or full `https://`; exact addresses only; chains and loops refused. → **ok**
2. Sitemap: **generated, read-only** (published pages, guides, areas; noindex left out; last-edited date).
3. robots.txt: editable, starting from today's file; refuse "Disallow: /" for all crawlers and a missing
   `Sitemap:` line. → **ok**
4. llms.txt: **(a) editable text box** starting from today's file.
5. Defaults: no answer → going with the suggestion, adjusted to what the pages really have (titles are hand-written
   in full, so there is no title suffix; there is no Twitter handle): **site name** (`og:site_name`, "LiveAccess"),
   **default share image** (logo.png), **default description** (for articles without one), **Twitter card type**
   (summary / large image).
6. **Save button, draft only**, like Menus. The Publish centre writes the real files later.

## Plan
- [x] 1. **Shared SEO code** `packages/shared/src/seo.ts` (tests first):
      - `buildSitemap(entries)` → sitemap.xml text (escaped `loc`, `lastmod` = YYYY-MM-DD). Test: today's 26 URLs.
      - `checkRobots(text)` → refuses `Disallow: /` in a `User-agent: *` group, a missing
        `Sitemap: https://liveaccess.ai/sitemap.xml` line, more than 20 KB. Test with today's file (OK) and bad ones.
      - `checkLlms(text)`: required, max 100 KB, plain text (no `<script`).
      - `validateRedirects(list, sitePages)`: from = `/path` (letters, digits, `- _ . /`, max 200, no `?`/`#`, not an
        existing page, no duplicates); to = site page or full `https://` (same checks as menu links); 301/302;
        refuses A→A, chains (A→B where B is itself redirected) and loops. Max 500 rules. Field errors per row.
      - `validateDefaults()`: site name 1–60 chars, description ≤ 300, share image = site image path or https URL,
        card type summary | summary_large_image.
- [x] 2. **Data**: no migration needed. Draft lives in `settings` rows: `seo.robots`, `seo.llms`, `seo.defaults`
      (each `{ value, version, updatedBy, updatedAt }` in the jsonb), and redirects in the `redirects` table with a
      version kept in `settings` (`seo.redirects`). First open → robots.txt and llms.txt read from the repo files,
      defaults from the home page's meta tags.
- [x] 3. **API** `/la-studio/api/seo` (login + CSRF, save limit), tests first:
      - `GET /` → redirects, robots, llms, defaults (+ versions, last edited by/at), the generated sitemap and
        its URL count, and the site pages list for the redirect target picker.
      - `PUT /redirects`, `PUT /robots`, `PUT /llms`, `PUT /defaults` → each `{ baseVersion, … }`; 409 "changed by X";
        422 with field errors; audit log entry. No page HTML or site file is touched.
- [x] 4. **Admin screen** `/la-studio/seo` (replaces the coming-soon page), styled like the prototype, three tabs:
      - **Redirects**: table of rules (old address, new address picker, 301/302, ✕), "+ Add redirect", Save.
      - **Sitemap, robots & llms.txt**: generated sitemap (read-only code box + URL count + note that noindex pages
        and drafts are left out), robots.txt text box + Save, llms.txt text box + Save.
      - **Defaults**: the four fields + Save.
      - Each Save shows Saved / Unsaved changes, errors next to fields, conflict banner; warns before leaving
        with unsaved changes.
- [x] 5. Verify: all tests, typecheck, build, headless-Edge check (add / edit / delete redirect, loop refused,
      robots "Disallow: /" refused, llms + defaults saved, reload) and a DB check that no page HTML changed.
- [x] Security gate · [x] Code review · [x] Wiki update (`cms.md`: SEO API)

**Not in this task:** writing the files / host redirect rules (Publish centre); redirect hit counts (need the live
host). The existing `.htaccess` rules (extensionless URLs, `/index.html`) stay as they are and aren't shown as
editable redirects.

## Log
- 2026-11-03: plan approved ("yes"). Shared `seo.ts` tests first (RED: module missing → GREEN). `buildSitemap` rebuilds
  today's `sitemap.xml` byte-for-byte from its 26 URLs and dates.
- Safe https check moved to `packages/shared/src/links.ts` (`safeHttpsUrl`), used by menus and redirects.
- API `cms/api/seo/routes.ts`: drafts in `settings` (`seo.robots|llms|defaults` hold `{ value, version, updatedBy,
  updatedAt }`; `seo.redirects` holds the version, rules live in `redirects`). No migration needed.
  `siteFilesRoot` (repo root) is where robots.txt / llms.txt are read on first open; CRLF → LF.
- Admin `screens/SeoEditor.tsx` (3 tabs, kept mounted so unsaved text survives tab switches). Link picker, saved
  pill and the unsaved-changes warning moved to `components/form.tsx` (shared with Menus).
- Bugs found by the tests and fixed: chain check also ran on rows whose old address was already invalid; seeded
  robots.txt kept Windows line endings while saves used LF.

## Verification
- Tests: shared 52/52 (seo 16), cms 80/80 (seo API 7). Typecheck clean, admin build OK.
- Headless Edge: tabs "Redirects | Sitemap, robots & llms.txt | Defaults"; "No redirects yet."; `/about.html` refused
  ("This address is a page on the site…"); fixed → saved; sitemap "generated, 26 URLs" with the home URL; robots.txt
  starts from today's file, "Disallow: /" refused with the reason next to the box; llms.txt edit saved; defaults
  start as LiveAccess / logo.png / summary, card type saved; unsaved robots text kept across tab switches; reload
  shows saved redirects, llms and defaults, and not the unsaved robots change.
- DB: pages + articles content hash identical before/after; `robots.txt`, `llms.txt`, `sitemap.xml` in the repo
  unchanged (git status clean). Test rows and test user removed afterwards.

## Security Gate
Status: PASSED after fixes (checklist + security-auditor agent, 2026-11-03)
Findings:
- ✅ Inputs validated server-side (redirects, robots, llms, defaults); auth + CSRF + Origin check; 30 saves/min/user;
  64 KB body limit; no new dependencies; no secrets; responses expose only names and timestamps.
- 🔴→✅ B1 `PUT /seo/constructor|__proto__|toString` passed the `in KEY` check (500 or junk settings row) →
  `Object.hasOwn`; API test for 4 inherited names.
- 🔴→✅ B2 redirects could take over real files (`/menu.js` → attacker script on every page, `/.well-known/…` →
  certificate issuance, `/robots.txt`…) → old address must end in `.html` or have no extension, no dot-folders, and
  can't be a real `.html` file in the site folder (404.html, download.html…). Tests added.
- 🔴→✅ B3 targets kept Apache variables/backreferences (`?%{HTTP_COOKIE}`, `$1`, `%1`) → refused. Tests added.
- 🟡→✅ chain check dodged by `liveaccess.ai.` / percent-encoding → host trailing dot stripped, path decoded. Test.
- 🟡→✅ `Disallow: /*` and `/$` now count as blocking the whole site. Tests.
- 🟡→✅ first-save race 409 no longer returns a made-up version.
- 🟡 For the Publish step (logged, not code here yet): write redirects with `Redirect 301` (mod_alias) or escaped,
  anchored `RewriteRule`s; HTML-escape defaults (site name, description) in meta tags.
- 🟡 Audit entries don't store before/after values (redirects and robots.txt changes can't be rolled back from the log).

## Code Review
Status: APPROVED
Notes:
- ✅ Does what was asked: 3 tabs as in the prototype; redirects add/edit/delete with 301/302; generated read-only
  sitemap; editable robots.txt and llms.txt with safety checks; defaults; Save buttons; drafts only.
- ✅ Edge cases: empty list, existing pages and files, duplicates, chains/loops, 500 cap, CRLF files, conflict,
  unsaved text kept across tab switches, warning before leaving.
- ✅ Reuse: link picker, saved pill and unsaved warning shared with Menus (`components/form.tsx`); `safeHttpsUrl`
  shared (`links.ts`); same version/409 pattern as pages and menus.
- ✅ Tests: shared 55 (seo 19), cms 80 (seo API 7); E2E twice; DB and repo files unchanged.
- 🟡 SUGGESTION: the sitemap's `lastmod` comes from `published_at`, which the import set to 2026-11-02 for pages
  (today's file says 2026-10-22); it becomes right once Publish sets real publish dates.
- 🟡 SUGGESTION: the redirect "hits" column stays 0 until the live host reports hits.
