# CMS (custom admin panel) — how it's built and run

Started 2026-11-02 on branch `feature/cms`. Plan: `docs/mm-skill/tasks/2026-10-30-custom-admin-panel.md` (v3.1),
Day 1: `docs/mm-skill/tasks/2026-11-02-cms-day1-foundation.md`. Plan page for Akash:
https://claude.ai/artifact/UZJy25p3EXk3SEdQDXvF6U · Prototype: https://claude.ai/artifact/N8NdazV7oCuJpYnY2BXTpM

## Decisions
- Custom admin panel; everything on Vercel later; must be movable to Azure/AWS (standard Node, PostgreSQL, storage adapter).
- Same domain, admin path is `ADMIN_PATH` (default `la-studio`, never `admin`). API at `/<ADMIN_PATH>/api/*`.
- Admin work must never affect the live site: two Vercel projects from one repo; the site is static and only changes on Publish.
- Layout lock: pages are stored as their current HTML; editors change text, images and SEO only (inline-only HTML, with the text
  editor's styles since 2026-11-12).
- Statuses: only Draft and Published (no review, no scheduling). Roles: Super Admin, Editor.
- Pages stay in the repo root until go-live (Day 8), because `.github/workflows/deploy.yml` FTP-copies root files.

## Layout
- `cms/` — Hono API (`api/`), Drizzle schema + migrations (`db/`), importer (`import/site.ts`), scripts, tests.
- `packages/shared/` — `sanitize.ts` (inline-only HTML allow-list) and `blocks.ts` (guide/area blocks ↔ article markup).
  Used by the importer now, the admin preview and the site build later.
- Root additions: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `docker-compose.yml`,
  `.env.example`, `.nvmrc`.

## Sign-in (JWT, 2026-11-06, Prabhat; task `docs/mm-skill/tasks/2026-11-06-cms-jwt-login.md`)
- `auth/login` and `auth/refresh` return `{ user, accessToken, expiresIn, csrfToken }`. The access token is an HS256 JWT (`api/auth/token.ts`) that lasts
  15 minutes, sent as `Authorization: Bearer`. The admin keeps it in a variable in `admin/src/lib/api.ts`, never in browser storage.
- The refresh token is the `sessions` row: cookie `la_refresh`, `httpOnly`, `SameSite=Strict`, path `/<ADMIN_PATH>/api/auth` only. It stays the same for the
  whole session, so two tabs can refresh together. Ending a session stops refreshes, so the code that deletes `sessions` rows needs no JWT knowledge.
- `requireUser()` trusts the token, so **a removed or demoted user keeps access on those routes for up to 15 minutes** (accepted by Prabhat).
  `requireFreshUser(db)` also checks the database: use it for anything that must take effect at once, or needs the full user row. Today: `/users`, `/audit`, `auth/change-password`.
- A demoted Super Admin can still save Menus, SEO and Site settings until the token expires, because those use `requireUser()`.
- CSRF: Bearer routes don't need it. `auth/logout` still needs `x-csrf-token`, because it runs on the cookie. `auth/refresh` relies on `SameSite` and the cross-site check in `app.ts`.
- The admin renews a token that expires within a minute before a call, when the user returns to the tab, and once after a 401. There's no timer: it would keep idle
  sessions alive past the 8-hour limit.
- `<link>` and `<img>` can't send a Bearer header, so dev-only `preview-assets` is open. It's mounted only under the `local` rule in `api/server.ts`. A file that
  isn't public must never be served through it.
- **`JWT_SECRET`** (32+ characters, different per environment) is required. `api/server.ts` refuses to start without it; the Vercel entry (Day 6) must call `env.jwtSecret()`
  at startup too. Changing it invalidates access tokens only: the admin gets a new one through the refresh cookie.

## API (all under `/<ADMIN_PATH>/api`, signed-in with a Bearer token)
- `auth/login`, `auth/refresh`, `auth/logout` — see Sign-in above.
- `pages` (Day 2) — list, `GET/PUT /pages/:key` `{ baseVersion, html?, seo? }` → draft in `pages.html`; 409 "changed by X"
  on an old version, 422 when the HTML breaks the layout lock (`api/pages/guard.ts`); `/:key/revisions`, restore.
- `menus` (2026-11-03) — `GET /menus` → draft header/footer menus, version, and the site's pages for the link picker;
  `PUT /menus` `{ baseVersion, menus }` → draft row `menus.location = 'site'`; 409 / 422 (`errors` per field path).
  Page HTML is never touched: the Publish centre will run `applyMenus` on every page.
- `seo` (2026-11-03) — `GET /seo` → redirects, robots, llms, defaults (each with version, last edited by/at), the
  generated sitemap (`{ xml, count }`) and the link list; `PUT /seo/redirects|robots|llms|defaults` `{ baseVersion, value }`
  → drafts in `settings` (`seo.*`) and the `redirects` table; 409 / 422 (`errors`). robots.txt / llms.txt are read from
  `siteFilesRoot` on first open. No page or site file is touched.
- `settings` (2026-11-03) — `GET /settings` (anyone signed in) → site name, footer tagline, App Store / Google Play
  links, public + alert email, GA4 / GTM IDs, version, `canEdit`; `PUT /settings` `{ baseVersion, value }` is **Super Admin
  only** (403 for Editors) → draft row `settings.key = 'site.settings'`. First open reads the live site.
- `guides` (2026-11-03) — `GET /guides` list; `POST /guides` `{ title }` → new Draft (slug from title, `-2`… if taken,
  starter blocks); `GET /guides/:id` → guide + a guide page as preview template + areas + `problems` (what Publish
  will need); `PUT /guides/:id` `{ baseVersion, slug, title, summary, areaSlug, publishedDate, blocks, seo }` → auto-save
  (partial validation; slug locked once live; 409 / 422); `DELETE /guides/:id` → never-published drafts only. Guide saves
  may be up to 512 KB. `articles.published` = what is live (hasChanges compares it).
- `areas` (2026-11-03) — same routes as guides from one module (`api/articles/routes.ts`, `articleRoutes("area")`):
  `GET /areas/:id` also returns the area's guides; saved with a Save button (30/min); a draft area's slug change moves
  its guides (version + 1, `area_renamed` audit); delete refused while guides use the area.
- Settings-row drafts share `api/versioned-setting.ts` (`saveVersioned`: lock, version check, first-save race → 409).
- `users` (2026-11-04) — Super Admin only (`requireSuperAdmin`): `GET /users`; `POST /users` `{ name, email, role }` → user
  + `temporaryPassword` (once); `PATCH /users/:id` `{ name?, email?, role?, status? }`; `POST /users/:id/reset-password`,
  `/unlock`. No delete. Last active Super Admin and your own role/status are protected, under row locks. Role change,
  disable or reset ends the user's sessions.
- `auth/change-password` `{ currentPassword, newPassword }` — 5 tries a minute, ends other sessions. While
  `users.must_change_password` is set, `requireUser` answers 403 `passwordChangeRequired` on everything else.
- `audit` (2026-11-04) — `GET /audit?page&user&group&from&to`, Super Admin only, read-only, 50 per page. `group`: content, website,
  users, publishing, sign-ins; default view hides `login`/`logout`. `detail` goes through an allow-list. Wording is in
  `admin/src/lib/audit.ts`: a new action needs a sentence there and a place in `GROUPS` (it shows by its raw name until then).
- `dashboard` (2026-11-04) — `GET /dashboard`, any signed-in user, read-only: `waiting` (pages, guides and areas, 10 most recently
  edited, with totals; reuses `changed` and `hasChanges`, so it matches the lists), `activity` (10 latest `CONTENT_ACTIONS`, with no
  IP, email or `detail`, because Editors can read it), `messages`, `lastPublish`. Menus, SEO and settings changes aren't listed.
  Sign-in and unknown addresses land here.
- Account rules: temporary passwords (typed or generated) expire after 72 hours; sessions end after 7 days as well as 8 idle
  hours; creating, promoting or resetting a Super Admin needs the caller's own password (5 wrong tries a minute).
- Roles: saving Menus, SEO & redirects and Site settings is Super Admin only; Editors get them read-only (`canEdit`).
- Saves are rate limited per user (`api/save-limit.ts`, in memory: pages 120/min, menus, SEO and settings 30/min).

## Media library (2026-11-06, Prabhat; task `docs/mm-skill/tasks/2026-11-06-cms-media-library.md`)
- `media` API: `GET /media?q&page` (48 a page, with `usedIn`), `POST /media` (form: `file`, `alt`), `PATCH /media/:id` `{ altText }`, `POST /media/:id/replace` (form: `file`), `DELETE /media/:id`
  (409 naming the pages while in use), public `GET /media/files/:key`. Anyone signed in can do all of it. 30 changes a minute per user.
- Uploads: `api/media/process.ts` re-encodes with `sharp`: JPG, PNG or WebP by real format, 10 MB and 50 megapixels at most, rotation applied, metadata removed, max 2400 px wide, saved as WebP under a random name.
- Files sit behind `api/media/storage.ts` (`put`, `get`, `remove`). Only `localDriver` exists, in `MEDIA_ROOT` (default `.media/`, git-ignored). **It can't work on Vercel: uploads there need a Blob driver.**
- Content stores `images/cms/<key>.webp`. That address only exists on the site after a build, so in the admin it goes through `toAdmin`/`fromAdmin` (`admin/src/lib/media.ts`). Anything shown
  uses `toAdmin`; anything saved from a DOM (page editor, Paragraph editor) must go through `fromAdmin`, or the API address gets stored.
- `/media/files/` is public because `<img>` can't send a token: anyone with the exact link can see an image that isn't published. Names can't be guessed or listed.
- Usage (`api/media/usage.ts`) scans draft and live copies of pages and articles. Page revisions aren't scanned, so restoring an old version can bring back a deleted image; the site build warns about it.
- Replace keeps the key, so every use changes at once. Alt text is copied when an image is chosen; editing it in the library doesn't change places already using it.
- `build-site.ts` copies only the files the built site uses.
- `sanitizeRich` allows `img` only with an exact library address, and keeps only `src` and `alt`. Jodit's own image plugin stays off: `laImage` in `RichTextEditor.tsx` opens the library.
- "Change image" keeps the width on the tag and only adjusts its height: a page's `width` attribute sizes the layout.
- Dashboard activity stays pages, guides and areas (`CONTENT_ACTIONS`); media actions show under Content in the Audit log only.

## Menus (`packages/shared/src/menus.ts`)
- `readMenus(html)` / `applyMenus(html, menus, pageFile)` work on text, only inside `<header class="site-header">` and
  `<footer class="site-footer">`; unchanged menus give back the page byte-for-byte (tested on all 29 pages). They throw
  if the header/footer isn't in the expected form, instead of guessing.
- `validateMenus`: max 6 header links, 8 per footer column, labels ≤ 30 chars, exactly 3 footer columns; links must be a
  site page (`about.html`, `./`, `guide-<slug>.html`, `area-<slug>.html`) or a full `https://` URL (no user:password,
  no hidden characters), stored normalised. External links get `target="_blank" rel="noopener"`.
- The footer's "Cookie settings" button always stays last in the Company column.

## SEO (`packages/shared/src/seo.ts`)
- `buildSitemap` matches the hand-written sitemap.xml layout (tested byte-for-byte); published, non-noindex pages and
  articles only.
- `checkRobots` refuses `Disallow: /`, `/*`, `/$` under `User-agent: *` and a missing Sitemap line; `checkLlms` plain text.
- `validateRedirects`: old address = old page address only (`.html` or no extension, no dot-folders), not a page or a
  real `.html` file in the site folder, not the admin path; target = site page or safe https without `$`, `%{`,
  `%<digit>` (Apache would expand them); no chains/loops (trailing-dot hosts and %-encoding seen through); max 500.
- Publish must write redirects as `Redirect 301` (mod_alias) or escaped, anchored rules, and HTML-escape the defaults.
- The site name lives in Site settings (not SEO Defaults).

## Guides (`packages/shared/src/guides.ts`)
- `renderGuidePage(template, guide, areaName, doc)` writes a guide into any guide page's markup (title, meta, og,
  canonical, JSON-LD, crumbs, h1, lede, byline, article); all 6 real guides rebuild byte-for-byte. Throws on an
  unexpected template. Layout rule: a heading sits right above its block, other blocks are separated by a blank line.
- `validateGuide(..., { partial })`: partial for auto-save (unfinished drafts OK; types, limits, slug format, sanitising,
  hidden characters still checked); full for Publish. Blocks: heading H2/H3, paragraph, bullet/numbered list, safety
  note, disclaimer (images with the Media library; quotes need new site CSS). Max 200 blocks, 100,000 characters.
- In the browser, sanitise in `document.implementation.createHTMLDocument("")`, never the admin page's `document`.
- **Paragraph editor (2026-11-05):** `cms/admin/src/components/RichTextEditor.tsx`, Jodit, guides and areas only, loaded on demand.
  Fonts and sizes follow Jodit's own lists (plus the two site fonts), kept in the `RICH_*` lists in `sanitize.ts`; the server removes anything
  off them. Colours are free (Prabhat, 2026-11-05): any solid colour, rewritten as `#RRGGBB`. Prabhat wants stock Jodit where possible. `cleanParagraph` gives the stored form: a single plain paragraph stays bare inline text, so existing guides don't
  change; anything richer starts with a block tag, and `isRichParagraph` picks the renderer from that. `.cms-table` is in `common.css`.
- **Jodit:** `jodit` 4.18.11, used directly, not through `jodit-react`. Its main module loads only core plugins, so others (justify,
  clean-html, paste, select-cells, symbols…) must be imported by hand, or their buttons quietly do nothing. Its colour popup's hex box
  and picker take the text selection away, so `RichTextEditor.tsx` holds it and puts it back. Font colour and Background colour are two
  buttons around Jodit's `ColorPickerWidget`, as its stock button has them on tabs. Emoji Picker is paid, so emoji is a custom dropdown. Update it when an advisory appears.
  Pasted HTML reaches the live page before any save, so it's cleaned on `beforePasteInsert`, drops are refused, and `admin/index.html` sets
  `base-uri 'self'; connect-src 'self'`. Add that as a header when the admin's hosting is set up.
- **Text editor (2026-11-12):** `RichTextEditor` has two modes. `"rich"` is the Paragraph box. `"text"` is for one element's text:
  undo/redo, font, size, B/I/U/S, font and background colour, link, emoji, symbols, remove formatting. No blocks, lists, tables,
  alignment or images, and Enter makes a `<br>`. `RichField.tsx` shows the formatted text and opens the editor on click or focus,
  one at a time (a page has 40+ fields). The editor sends its last state when it closes, because Jodit reports changes a moment late.
  - Where: guide and area list items, Safety note text, Disclaimer text, the area **Intro line**, and every website page text field
    except short labels (`PLAIN_LABELS` in `fields.ts`: button and link text, numbers, labels, form labels; `richField(f)` decides).
    Plain boxes, by choice (Prabhat, 2026-11-12): area Name, guide Title and Summary, Heading blocks, the Safety note title.
  - Rules: `sanitizeText` in `sanitize.ts` is the `sanitizeInline` set plus `u`, `s` and `style` through `richStyle(…, false)`
    (no alignment). Without those extras it gives exactly `sanitizeInline`'s output, tested on every element of every page.
  - The area `summary` is HTML from the editor. The `lede` shows it, while meta, og, JSON-LD and the Process areas card use
    `plainText`. The guide `summary` stays plain text.
  - Page guard (`api/pages/guard.ts`): also allows `u`/`s`, and a `style` on an inline text tag when `richStyle(value, false) === value`.
    Styles on layout elements still can't change.
  - Fields: text formatted from end to end (`<h1><span style>…</span></h1>`) has no text of its own. `buildFields` still makes the
    outer element the field when the inside carries the editor's marks (`formattedOnly`). Without that, the field moved to the
    inner span and lost its label after a reload. The site's own pages have none of these marks.
  - Jodit shows "0px" in the size box for text with no element of its own: its select falls back to its list's first key ("0"). The size
    control's `value` falls back to the editor's real size.
- **Don't start a second Vite:** a failed `pnpm dev:admin` (port in use) still rewrites `.vite/deps`, and the running server then answers
  504 "Outdated Optimize Dep" and the admin goes blank. Stop every copy, then start one.

## Process areas (`packages/shared/src/areas.ts`)
- `renderAreaPage(template, area, guides, doc)`: title "<Name>: process area | LiveAccess", og:title "<Name> | LiveAccess",
  breadcrumb JSON-LD, crumbs, h1, lede, article (area spacing: blank line only before headings), the "Guides for
  <name>." band built from the guides (title + first sentence of the summary; no band when there are none) and the CTA
  "Questions about <name>?". All 8 real area pages rebuild byte-for-byte.
- `validateArea` = `validateGuide` with `kind: "area"` (no area/date). New areas are site pages only; the app's Expert
  Network and the "8 process areas" chips on home/features are separate.

## Site settings (`packages/shared/src/site-settings.ts`)
- GA4 ID is required (`G-…`) and can never be emptied (standing rule: the GA4 tag stays on every page); GTM optional,
  added alongside GA4.
- Store links: exact hosts `apps.apple.com` / `play.google.com`; the Play link is only `…/details?id=…` and Publish
  keeps each page's own `&referrer=utm_…`. Email is strict (no `? & = % #`) because it goes into mailto links.
- Publish must HTML-escape site name and tagline (text, attributes, JSON-LD).

## Local preview (2026-11-04)
- Publish centre → **Build preview**, or `pnpm build:site`: `cms/publish/build-site.ts` turns the drafts into a complete
  site in `.site-preview/` (git-ignored; built in `.site-preview.tmp/`, swapped in only on success). Nothing is published
  and no draft changes. `pnpm dev:api` serves it at `http://localhost:4000/` (`PREVIEW_PORT`, 127.0.0.1 only, dev only).
- The output is what real Publish will write. Preview safety is only in the headers of `cms/api/preview-server.ts` (CSP
  blocks GA/GTM/Formspree, noindex, no-store), which also copies `.htaccess` behaviour and reads its `Redirect` lines.
- `POST /publish/preview`, `GET /publish/preview`: signed-in, one build at a time, mounted only with `AppConfig.preview`.
- Drafts that fail full validation: never-published ones are left out, live ones use their `published` copy; both are listed.
- `packages/shared/src/publish.ts`: `applyPageSeo`, `applySiteSettings`, `applyConsentJs`, `applySeoDefaults`,
  `redirectsHtaccess`. A matching value leaves the page byte-for-byte (tested on all 29 pages).
- Site name goes into `og:site_name` only. GA4 is also written into `consent.js`.
- **GTM isn't applied:** `consent.js` loads only the first consent-gated tag, so the build warns instead.
- `applyListing` keeps `guides.html` (cards + JSON-LD `ItemList`) and `process-areas.html` in step with what was built:
  page order kept, new items last, card text only rewritten when the summary changed (it's hand-shortened on some cards).
- **Before real Publish:** harden `cms/api/pages/guard.ts` (see the Security Gate in
  `docs/mm-skill/tasks/2026-11-04-cms-local-publish.md`). Draft page HTML would otherwise reach the live site.
- The preview passes **only** `POST /<ADMIN_PATH>/api/contact` to the API in the same process (`previewSite(dir, { adminPath, send })`),
  so the built contact form can be tried locally. Every other POST is still 405.

## Contact inbox (2026-11-12, Prabhat; task `docs/mm-skill/tasks/2026-11-12-cms-contact-inbox.md`)
- **Form → CMS:** `POST /<ADMIN_PATH>/api/contact` (`cms/api/contact/routes.ts`) is the CMS's **only route without sign-in**. It takes
  the site's `FormData` or JSON. Prabhat chose this address (1b), so the admin path shows in contact.html's source.
- The repo's `contact.html` still has the Formspree placeholder. Only the site build (`applyContactForm` in `publish.ts`) points the form at the
  CMS and adds the hidden `_elapsed` field, plus a one-line script that fills it with `performance.now()` (time on the page) when the form is sent.
  The script listens on `document` in the capture phase, so it runs before the page's own submit handler builds its `FormData`.
  The live FTP site keeps its broken form until Publish goes live.
- **Spam:** a filled `_gotcha`, or a missing or under-3-second `_elapsed`, gets the same `{ ok: true }` as a real message, but nothing is stored
  (only `contact form: dropped (<reason>)` is logged). Time on the page, not a timestamp, so a visitor's wrong clock doesn't drop real messages.
  The route also needs an `Origin` or `Sec-Fetch-Site: same-origin` header, which refuses old browsers posting from other sites.
- Limits are counted **in the database** (not memory, so they hold on Vercel): 5 per hour per visitor, 100 per hour in total (429). The count
  and the insert run in one transaction under `pg_advisory_xact_lock`, because a burst of parallel requests otherwise all passed the count
  (found by the security review). Index `contact_ip_time_idx` (migration 0008).
- A visitor = `ip_hash` = HMAC-SHA256(`JWT_SECRET`, `visitorKey(ip)`): the IPv4 address, or the **IPv6 /64** (one connection owns a whole /64),
  or one shared `unknown` key when no address is known. Changing `JWT_SECRET` resets the counts, nothing else. The local preview passes its
  server context on, so the API sees the real address there too.
- **Known limit:** the 100-per-hour total can still be filled by someone using many networks, which blocks real visitors for that hour.
  Before go-live, consider an edge or WAF rate limit, or a challenge (for example Turnstile) once the limit is reached.
- Checks: name 1–200, email ≤ 254, company ≤ 200, message 1–5,000, no hidden or control characters (line breaks are fine). An unknown topic
  becomes "Something else". `notifyNewMessage()` is where email goes once the mail service is chosen (Prabhat: "decide at later stage").
  The name may hold `" < ,` and the address `' % ? &`: never put them in mail headers as raw text, and never log the message.
- **Inbox:** `/<ADMIN_PATH>/api/messages` (signed-in). Statuses `new → read → replied → archived`. Opening a new one marks it read.
  `status_changed_at`/`_by` (migration 0007) record who and when. "All" leaves out archived. Search uses ILIKE with `% _ \` escaped.
- Delete is **Super Admin only**, logged as `message_deleted` with the id only (no name, email or text in the audit log).
- **12-month clean-up:** replied and archived messages are deleted 12 months after `status_changed_at`, when the inbox is opened (at most once
  an hour per server), logged as `messages_purged` with the count. There's no scheduler yet.
- The screen (`ContactInbox.tsx`): the reply `mailto:` encodes the address, because `?` and `&` are legal in addresses and could add a BCC.
- **Privacy policy:** its "Contact form" item still mentions a third-party form service. The new wording is in the task record. It must be
  pasted in the CMS Privacy draft and published together with the form switch.

## Gotchas
- **Admin URL needs the trailing slash in dev:** `http://localhost:5173/la-studio/` (without it Vite shows its base-URL page).
- **FTP guard rail:** never add `*.html *.css *.js *.png *.svg *.mp4 *.txt *.xml *.woff2` files in the repo root on any
  branch that reaches `main` — `deploy.yml` uploads them to the live server.
- **`.gitignore`** is the Visual Studio template; its NuGet rule `**/[Pp]ackages/*` hid `packages/`. Fixed with
  `!/packages/*/`.
  Its `publish/` rule hid `cms/publish/` and `cms/api/publish/` too (fixed the same way): check `git status` for new folders.
- **pnpm** (11.6) uses `saveExact` and `minimumReleaseAge: 10080` (7 days); esbuild install scripts are blocked on
  purpose (`allowBuilds: esbuild: false`) and tsx / drizzle-kit work without them.
- **linkedom** overflows on extremely deep nesting; `sanitizeInline` strips tags when nesting > 200 before parsing.
- Refresh cookie is `Secure` by default; local dev sets `CMS_INSECURE_COOKIES=1` in `.env`, which also turns on the admin preview's site files. Proxy headers are trusted
  only when `VERCEL=1` or `TRUST_PROXY=1`.

## Run locally
```
cp .env.example .env          # then set JWT_SECRET (the command is in the file)
docker compose up -d          # PostgreSQL 16 on 127.0.0.1:5433 (dbs: liveaccess, liveaccess_test)
pnpm install
pnpm db:migrate
pnpm db:seed-admin            # prompts for the admin@example.com password (min 12 chars)
pnpm import:site              # 12 pages, 6 guides, 8 process areas (first time only: it overwrites page drafts)
pnpm dev:api                  # http://localhost:8787/la-studio/api
pnpm dev:admin                # http://localhost:5173/la-studio/  (admin app, proxies /la-studio/api)
pnpm build:site               # local preview from the drafts, open http://localhost:4000/
pnpm test && pnpm typecheck
```
Schema changes: edit `cms/db/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate`.
After pulling a change with a new migration, run `pnpm db:migrate` before using the admin. Otherwise the new screens answer
"Something went wrong" (the API's 500 for a missing column; this happened with the Contact inbox, 2026-11-12).

## Migrations on Vercel (2026-11-06)
`vercel.json` builds the admin, then runs `pnpm db:migrate` on Production deployments only (`VERCEL_ENV`). A failed migration fails the deployment, and a failed build never migrates. It overrides the
dashboard's Build Command. Previews don't migrate, so they mustn't share the production database: a preview with a newer schema would break until the next Production deployment. Migrations must stay
additive where possible, because they run before the new code goes live. The file only applies if the project's Root Directory is the repo root; if it's `cms`, the file belongs there (both scripts exist there too).

## Admin output on Vercel (2026-11-06)
`vercel.json` publishes `cms/dist`, and Vite builds into `cms/dist/<ADMIN_PATH>` so files sit at the URLs the page asks for (`/la-studio/assets/...`). Don't point `outputDirectory` at the admin folder itself (blank page) or at `.` (publishes the whole repo).
`vercel.json` can't read `ADMIN_PATH`, so `la-studio` is written in its redirect and rewrites: change them together.

## API on Vercel (2026-11-13; task `docs/mm-skill/tasks/2026-11-12-cms-vercel-api-function.md`)
- `api/cms.ts` (repo root) is the Function; `cms/api/vercel.ts` builds the app for it. `vercel.json` rewrites `/la-studio/api/:path*` to `/api/cms`, before the
  admin-page rewrite, and Vercel adds the matched part as `?path=`; `restoreRequest()` turns it back into `/la-studio/api/...` and refuses `..`.
- Vercel compiles `api/cms.ts` with the **root `tsconfig.json`** (`rewriteRelativeImportExtensions` turns `./x.ts` into `./x.js`); `api/package.json` makes it
  an ES module. `@liveaccess/shared` exports `./src/index.ts`, so its `.ts` files ship through `includeFiles` and Node 24 runs them. Check with
  `npx vercel@65.7.0 build` in a copy of the repo (the build command's `if [ ... ]` needs a Linux shell).
- Region `iad1`, next to the Neon database (US East). Pool of 2 connections per instance.
- Not on Vercel yet: image uploads (503, no Blob driver), the local preview. The save limiter is per instance.
- Vercel environment: `DATABASE_URL` (Neon, direct or pooled), `JWT_SECRET` (32+ characters), optional `ADMIN_PATH`, and for Publish `GITHUB_TOKEN`,
  `GITHUB_REPO`, `GITHUB_BRANCH`.
- **`TEST_DATABASE_URL` must be a local database.** The tests empty every table; `test/helpers.ts` refuses any host but localhost since 2026-11-13, after a
  run against Neon wiped it and left a test Super Admin there.

## Publish to the website (2026-11-13; task `docs/mm-skill/tasks/2026-11-13-cms-preview-on-vercel.md`)
- Publish centre → "Publish to website" (Super Admins, checked in the database). `POST /publish/live`: reads the site files of the branch's latest commit
  from GitHub into `/tmp`, builds the drafts on top of them (`buildSiteInto`), and commits **only files that differ** (Git blob hash) as one commit
  "Publish from CMS by <name>". The drafts it used are marked published after the commit lands. If the branch moved meanwhile, nothing is written (409).
- Building on the branch, not on the Function's copy of the files, means a publish never undoes someone else's change to `common.css` or a page.
- Only `SITE_PATH` files (top-level site files, `.htaccess`, `images/`) are read or written; never `cms/`, `api/`, `.github/` or `vercel.json`. The 13 MB
  video isn't read (GitHub answers it, but the CMS never changes it). Nothing is deleted from the repo.
- `.htaccess`: the build strips an existing "# Redirects from the CMS." block before adding the current one (`withoutCmsRedirects`).
- Target today: `prabhatmegamindstechnologies/liveaccess-cms` `main`, which has no FTP secrets: `deploy.yml` skips the upload there (`HAS_FTP`), so
  `liveaccess.ai` doesn't change. Pointing `GITHUB_REPO` at the company repo makes Publish reach the website.
- `vercel.json` `ignoreCommand`: a commit that only changes site files (a publish) doesn't rebuild the CMS.
- **Pushing code after Publish is in use:** the CMS commits to `main`, so `git push personal feature/cms:main --force` would erase publishes. Use
  `git pull personal main` (merge), then push without `--force`.
- Token: GitHub → Settings → Developer settings → Fine-grained tokens, only this repository, permission Contents: Read and write.
