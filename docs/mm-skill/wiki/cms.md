# CMS (custom admin panel) — how it's built and run

Started 2026-11-02 on branch `feature/cms`. Plan: `docs/mm-skill/tasks/2026-10-30-custom-admin-panel.md` (v3.1),
Day 1: `docs/mm-skill/tasks/2026-11-02-cms-day1-foundation.md`. Plan page for Akash:
https://claude.ai/artifact/UZJy25p3EXk3SEdQDXvF6U · Prototype: https://claude.ai/artifact/N8NdazV7oCuJpYnY2BXTpM

## Decisions
- Custom admin panel; everything on Vercel later; must be movable to Azure/AWS (standard Node, PostgreSQL, storage adapter).
- Same domain, admin path is `ADMIN_PATH` (default `la-studio`, never `admin`). API at `/<ADMIN_PATH>/api/*`.
- Admin work must never affect the live site: two Vercel projects from one repo; the site is static and only changes on Publish.
- Layout lock: pages are stored as their current HTML; editors change text, images and SEO only (inline-only HTML).
- Statuses: only Draft and Published (no review, no scheduling). Roles: Super Admin, Editor.
- Pages stay in the repo root until go-live (Day 8), because `.github/workflows/deploy.yml` FTP-copies root files.

## Layout
- `cms/` — Hono API (`api/`), Drizzle schema + migrations (`db/`), importer (`import/site.ts`), scripts, tests.
- `packages/shared/` — `sanitize.ts` (inline-only HTML allow-list) and `blocks.ts` (guide/area blocks ↔ article markup).
  Used by the importer now, the admin preview and the site build later.
- Root additions: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `docker-compose.yml`,
  `.env.example`, `.nvmrc`.

## API (all under `/<ADMIN_PATH>/api`, signed-in; changes need the `x-csrf-token` header)
- `auth/login`, `auth/logout`, `auth/me` — server-side sessions, cookie `la_session` (path `/<ADMIN_PATH>`).
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
- Settings-row drafts share `api/versioned-setting.ts` (`saveVersioned`: lock, version check, first-save race → 409).
- Saves are rate limited per user (`api/save-limit.ts`, in memory: pages 120/min, menus, SEO and settings 30/min).

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
  note, disclaimer (images with the Media library; tables/quotes need new site CSS). Max 200 blocks, 100,000 characters.
- In the browser, sanitise in `document.implementation.createHTMLDocument("")`, never the admin page's `document`.

## Site settings (`packages/shared/src/site-settings.ts`)
- GA4 ID is required (`G-…`) and can never be emptied (standing rule: the GA4 tag stays on every page); GTM optional,
  added alongside GA4.
- Store links: exact hosts `apps.apple.com` / `play.google.com`; the Play link is only `…/details?id=…` and Publish
  keeps each page's own `&referrer=utm_…`. Email is strict (no `? & = % #`) because it goes into mailto links.
- Publish must HTML-escape site name and tagline (text, attributes, JSON-LD).

## Gotchas
- **Admin URL needs the trailing slash in dev:** `http://localhost:5173/la-studio/` (without it Vite shows its base-URL page).
- **FTP guard rail:** never add `*.html *.css *.js *.png *.svg *.mp4 *.txt *.xml *.woff2` files in the repo root on any
  branch that reaches `main` — `deploy.yml` uploads them to the live server.
- **`.gitignore`** is the Visual Studio template; its NuGet rule `**/[Pp]ackages/*` hid `packages/`. Fixed with
  `!/packages/*/`.
- **pnpm** (11.6) uses `saveExact` and `minimumReleaseAge: 10080` (7 days); esbuild install scripts are blocked on
  purpose (`allowBuilds: esbuild: false`) and tsx / drizzle-kit work without them.
- **linkedom** overflows on extremely deep nesting; `sanitizeInline` strips tags when nesting > 200 before parsing.
- Session cookie is `Secure` by default; local dev sets `CMS_INSECURE_COOKIES=1` in `.env`. Proxy headers are trusted
  only when `VERCEL=1` or `TRUST_PROXY=1`.

## Run locally
```
cp .env.example .env
docker compose up -d          # PostgreSQL 16 on 127.0.0.1:5433 (dbs: liveaccess, liveaccess_test)
pnpm install
pnpm db:migrate
pnpm db:seed-admin            # prompts for the admin@example.com password (min 12 chars)
pnpm import:site              # 12 pages, 6 guides, 8 process areas
pnpm dev:api                  # http://localhost:8787/la-studio/api
pnpm dev:admin                # http://localhost:5173/la-studio/  (admin app, proxies /la-studio/api)
pnpm test && pnpm typecheck
```
Schema changes: edit `cms/db/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate`.
