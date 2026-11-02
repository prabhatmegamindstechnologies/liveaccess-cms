# Custom admin panel (CMS) for liveaccess.ai

- **Flow:** NEW_PROJECT (new admin app + API + database next to the existing static site)
- **Date:** 2026-10-30 (updated 2026-11-02)
- **Branch:** PT_ClientUpdate (planning only, no code yet)
- **Status:** Plan approved by Prabhat (2026-10-30). Next: share with Akash. No development until Akash approves and
  the current client work is wrapped up (his instruction).
- **Requested by:** Akash Kathiriya — "make this liveaccess as CMS where from admin panel we can manage content and images.
  Make sure application has solid load performance like what it currently has with pure html. Share full proof plan
  before any development. First wrap existing stuff."
- **Prototype (clickable):** https://claude.ai/artifact/N8NdazV7oCuJpYnY2BXTpM
- **Plan page for Akash:** https://claude.ai/artifact/UZJy25p3EXk3SEdQDXvF6U
- **Note:** this file was lost once as an untracked file (2026-11-02) and recreated. Commit it or keep a copy.

## Done = (for this planning step)
A written plan plus a clickable prototype that shows every admin screen (login → pages → articles → SEO → media →
settings → publish), so Akash can approve scope, stack and database before any code is written.

## Brainstorm — confirmed answers
| Question | Answer |
|---|---|
| Admin panel type | **Custom admin panel** (not Sveltia/Decap) — user decision |
| Hosting (2026-11-02, Akash) | **Everything on Vercel.** Must be possible to move to Azure / AWS quickly if the client asks. |
| Admin URL (2026-11-02, Akash) | **Same domain, not `/admin`.** Path is a setting (`ADMIN_PATH`), example `/la-studio`; final name from Akash. |
| Isolation (2026-11-02, Akash) | **Admin work must never affect the live site.** |
| Estimate (2026-11-02, Akash) | **6–8 days max** ("we have Claude"). Plan v3 = 8 working days with fixed scope. |
| Login | **Email + password only** for now (no 2FA, no SSO) |
| Article editor | **Block editor**: Heading, Paragraph, List / numbered steps, Image (left / right / centre / full), Safety note, Disclaimer, Table, Quote, drag to reorder |
| Extra modules | **All**: home, menus, FAQ, SEO per page, 301 redirects, sitemap/robots/llms.txt, contact inbox, site settings, media library, version history, draft/preview, audit log, team page, multi-language later |
| Statuses (2026-11-02) | **Only Draft and Published.** No "In review" (no approval step, no Reviewer role) and no "Scheduled" (no future-date auto-publish) — user decision |
| Stack / publish model / DB | Not answered → **defaults below**, flagged for Akash to confirm |

## v3 architecture (2026-11-02) — supersedes the v2 Architecture, Stack and Phases sections below
Plan page: https://claude.ai/artifact/UZJy25p3EXk3SEdQDXvF6U (v3)

```
                        liveaccess.ai  (one domain, Vercel)
        ┌───────────────────────────────┴────────────────────────────────┐
  / , *.html, images                                   /<ADMIN_PATH>/*  and  /api/contact
        │                                                  (rewrite in site's vercel.json)
        ▼                                                                  ▼
 PROJECT 1 · PUBLIC SITE (live)                         PROJECT 2 · CMS
  static HTML/CSS/images on Vercel CDN                   React admin (port of prototype)
  vercel.json: redirects, headers, HSTS                  API: Node.js + TypeScript (Hono) on Vercel Functions
  no server code, no DB at request time                  PostgreSQL (Neon, Vercel Marketplace) + Drizzle
  changes ONLY on Publish (new immutable deploy)         Media: Vercel Blob behind a storage adapter
        ▲                                                Build script: writes site HTML from DB + current templates
        └──────── Deploy Hook (on Publish) ◀──────────────────┘
```
- **Isolation:** separate Vercel projects; admin code deploys never redeploy the site; the site has no runtime link
  to the CMS (only the contact form submit goes to the API); drafts never reach the site; every publish is a new
  deployment, failed build/checks keep the old one live; Instant Rollback; dev/preview builds use a separate
  Neon database branch.
- **Content model (from the prototype):** fixed pages are stored as their current HTML; the editor extracts fields from
  the real page (text, images, repeating items) and writes back only those elements. Guides/areas = blocks rendered
  into the current guide/area page as template. No Eleventy — a small Node build script assembles files, sitemap.xml,
  llms.txt, vercel.json redirects, and copies media into the site output (site never loads media from storage).
- **Admin path:** `ADMIN_PATH` env var; not listed in robots.txt (that would reveal it); `X-Robots-Tag: noindex`
  on all CMS responses. Login, lockout, rate limits and roles do the protecting.
- **Portability:** static site → Azure Static Web Apps / S3+CloudFront; API → App Service / Container Apps / App
  Runner / ECS / Lambda (Dockerfile included); PostgreSQL → Azure DB for PostgreSQL / RDS (`pg_dump`/`pg_restore`);
  media → Azure Blob / S3 (`STORAGE_DRIVER`); Deploy Hook → GitHub Actions; rewrite → staticwebapp.config.json /
  CloudFront behaviour. Expected move: 1–2 days + DNS.
- **Unverified (check on the account before Day 1):** Vercel external rewrites, Deploy Hooks, Instant Rollback,
  Neon/Blob in the Marketplace, and that a commercial site needs the Pro plan — all from memory (mid-2026).

### Repository (one monorepo, two Vercel projects)
```
LiveAccess-Website/
├── site/              → Vercel Project 1 (Root Directory site/)  templates/ (current pages), build.js, vercel.json
├── cms/               → Vercel Project 2 (Root Directory cms/)   admin/ (React), api/ (Hono), db/ (Drizzle), Dockerfile
├── packages/shared/   sanitize.ts, fields.ts, blocks.ts, storage.ts — used by admin preview AND site build
└── docs/mm-skill/
```
- Ignored Build Step: site skips builds when only `cms/` changed; CMS skips when only `site/` changed.
- Site deploys on Publish (Deploy Hook) or changes in `site/` / `packages/shared/`.
- Environments: local (Neon dev branch, local storage driver) · preview per PR (Vercel preview URLs, Neon preview
  branch, separate Blob store) · production (liveaccess.ai, Neon main).
- API: `/api/auth/*`, `/api/pages`, `/api/articles`, `/api/media`, `/api/menus|settings|redirects|users`
  (Super Admin), `POST /api/publish`, `GET /api/build/content` (build token only), `POST /api/contact` (public,
  rate-limited).

### v3 8-day plan (one developer, Claude Code + mm-skill)
| Day | Work |
|---|---|
| 1 | Repo, two Vercel projects, Neon DB, schema, login/users; import current 29 pages into DB |
| 2 | Admin shell, pages list, real-page field editor + live preview, SEO tab, history |
| 3 | Guides/areas block editor, slugs, image positions, media upload + library |
| 4 | Build script, Deploy Hook, checks (links, titles, alt text, HTML diff), Publish centre, rollback |
| 5 | Menus, site settings, redirects, contact API + inbox, audit log |
| 6 | Admin-path routing on liveaccess.ai, rate limits, CSRF, upload checks, security review; staging on preview URL |
| 7 | QA: HTML comparison for all pages, Lighthouse, mobile, fixes |
| 8 | DNS to Vercel, final checks, handover; FTP hosting kept as fallback for a week |

**Out of the 8 days:** email alerts / password reset by email, Lighthouse inside every publish, team page,
multi-language, an actual Azure/AWS move.

**Open questions (v3):** admin path name; Vercel account/plan owner; Neon + Vercel Blob OK; who changes DNS on
go-live; can Editors change Privacy/Terms.

## Architecture (v2, superseded by v3 above)
```
Editor ──▶ Admin panel (React SPA, /admin)
                │  HTTPS + session cookie
                ▼
           API (Node.js + Fastify + TypeScript)
                │
      ┌─────────┼──────────────┐
      ▼         ▼              ▼
 PostgreSQL   Media storage   Publish worker
 (content,    (originals +    1. export published content as JSON
  users,       WebP/AVIF       2. Eleventy builds static HTML
  SEO, logs)   variants)       3. checks: Lighthouse, links, SEO lint
                               4. FTP upload to current Apache host
                                        │
Visitor ──────────────────────────────▶ liveaccess.ai (plain HTML, same as today)
```
- **Public site stays static HTML** on the current Apache hosting. No database or API call when a visitor opens a page.
  This is what keeps load performance identical to today.
- **Publish = rebuild.** When an editor clicks Publish, the worker rebuilds the affected pages and uploads them.
  Live in about 1–3 minutes.
- **Only one public API endpoint:** `POST /api/contact` for the contact form (CORS limited to liveaccess.ai,
  rate-limited, honeypot field). Everything else needs login.

## Layout lock (requirement, 2026-10-30)
The admin panel must never change the existing website layout or design.
- The current HTML pages become the templates as they are: same markup, same classes, same `common.css`, same
  page `<style>` blocks. Only text, images, links and SEO values become fields.
- Text fields accept inline formatting only (`<em>`, `<strong>`, `<a>`, `<br>`, plain `<span>`). Anything else is
  stripped on save, so an editor cannot add new layout.
- Repeating items (cards, table rows, list items, FAQ questions) can be added, moved or removed. A new item is a copy
  of an existing one, with the same markup.
- Guides and process areas use the current guide / process-area page as their template. Existing block types map to
  existing styles (h2, p, ul/ol, `.note-safety`, `.article-note`). The new block types (image with position, table,
  quote) need a few lines of CSS scoped to `.article`, built from the site's tokens. Nothing else in `common.css`
  changes.
- Publish check: compare the built HTML against the current page; only the edited text may differ.

## Stack (defaults — confirm with Akash)
| Part | Choice | Why |
|---|---|---|
| API | **Node.js 20+, Fastify, TypeScript** | Team already uses Fastify in m1rest |
| ORM / migrations | **Prisma** | Typed queries, safe migration files |
| Database | **PostgreSQL 16** | See next section |
| Admin UI | **React + Vite + TypeScript**, TanStack Query, React Hook Form + Zod | Fast SPA, form validation shared with API (Zod) |
| Block editor | Custom blocks + **dnd-kit** (drag/reorder) + **Tiptap** (bold/links inside paragraphs) | Full control of block types, image position and clean HTML output |
| Images | **sharp** | Resize, WebP/AVIF, strip EXIF |
| Static build | **Eleventy** | Zero JS on public pages; current HTML becomes the templates |
| Checks | Lighthouse CI, linkinator, custom SEO lint | Publish fails if speed/SEO drops |
| Passwords | **argon2id** | Current recommended password hash |

Versions are from memory (mid-2026) — verify latest stable on npm before starting and pin exact versions.

### Rejected
- **Sveltia/Decap CMS** — user wants a fully custom panel with email/password login.
- **Server-rendering pages from the DB on each visit** (Next.js SSR, WordPress) — slower pages, conflicts with Akash's
  performance requirement.
- **NestJS** — fine, but heavier; team already knows Fastify.
- **Review/approval workflow and scheduled publishing** — not needed (user decision, 2026-11-02).

## Database: PostgreSQL (recommended)
| Option | Verdict |
|---|---|
| **PostgreSQL** | **Recommended.** Free, runs on any VPS or managed (Azure / AWS / DigitalOcean). JSONB stores page fields and article blocks and can be queried/indexed. Built-in full-text search for the admin search box. |
| SQL Server / Azure SQL | Good if the company standardises on Azure (m1rest uses mssql). Paid licence outside Express edition. JSON support is weaker than JSONB. Second choice. |
| MySQL / MariaDB | Often included with shared hosting. Works, but JSON handling is weaker. Third choice if hosting forces it. |
| SQLite | Small enough for this site, but no managed hosting, harder concurrent edits/backups. Rejected. |

### Tables
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, name, email (unique), password_hash, role, status, failed_logins, locked_until, last_login_at | roles: `super_admin`, `editor` |
| `sessions` | id, user_id, token_hash, ip, user_agent, expires_at | httpOnly cookie holds the token, DB holds only its hash |
| `pages` | id, key (unique: home, about, contact, features, how-it-works, faq, privacy, terms, delete-account, get-app, guides, process-areas), fields JSONB, status, SEO columns, updated_by, published_at | fixed pages; fields are the editable text/image slots of the page template |
| `articles` | id, type (`guide` / `process_area`), title, slug, summary, area_slug, blocks JSONB, status (`draft` / `published`), author_id, published_at, SEO columns | unique (type, slug) |
| `team_members` | id, name, role, photo_media_id, bio, sort_order | for a future Team section |
| `media` | id, file_name, path, mime, width, height, bytes, alt_text, caption, variants JSONB, uploaded_by | alt text required |
| `menus` | id, location (header, footer_product, footer_resources, footer_company), items JSONB | |
| `site_settings` | key, value JSONB | app store links, GA4 ID (G-JFHJD3T51M), GTM ID, contact email |
| `redirects` | id, from_path (unique), to_path, code (301/302), is_auto, hits | auto-created when a published slug changes; written into .htaccess on publish |
| `contact_submissions` | id, name, email, company, topic, message, page, status (new/read/replied/spam), ip_hash, created_at | replaces the unfinished Formspree form |
| `revisions` | id, entity_type, entity_id, snapshot JSONB, user_id, note, created_at | version history + restore |
| `audit_log` | id, user_id, action, entity_type, entity_id, diff JSONB, ip, created_at | who changed what and when |
| `publish_jobs` | id, triggered_by, status (queued/building/checking/uploading/live/failed), log, started_at, finished_at | publish history + error messages |

FAQ questions are stored as the FAQ page's repeating fields (no separate table); FAQPage JSON-LD is built from them.

SEO columns on `pages` and `articles`: `meta_title`, `meta_description`, `og_image_id`, `canonical_url`, `noindex`.
Blank meta_title falls back to the page title; blank OG image falls back to the site default.

Indexes: `articles (type, slug)` unique, `articles (type, status)`, `redirects (from_path)` unique,
`contact_submissions (status, created_at)`, `audit_log (entity_type, entity_id, created_at)`, GIN full-text on
article title + summary.

## Article blocks (guides and process areas)
Stored as an ordered JSON array in `articles.blocks`:
```json
[
  { "type": "heading",   "level": 2, "text": "Common causes" },
  { "type": "paragraph", "html": "Fouling builds up when <strong>...</strong>" },
  { "type": "image",     "mediaId": 42, "position": "right", "caption": "Fouled tube sheet", "alt": "..." },
  { "type": "list",      "style": "number", "items": ["Check feed temperature", "Check CIP log"] },
  { "type": "callout",   "variant": "safety", "title": "Safety first.", "text": "Isolate and lock out..." },
  { "type": "callout",   "variant": "disclaimer", "text": "This guide gives general checks..." },
  { "type": "table",     "rows": [["Symptom", "Likely cause"], ["...", "..."]] },
  { "type": "quote",     "text": "...", "cite": "TPS engineer" }
]
```
- **Image position:** `left` / `right` (text wraps, ~44% width, stacks full-width on phones), `center` (~70%),
  `full` (full content width). Each image gets `srcset`, width/height and lazy-loading on build.
- Inline HTML is sanitised on the API (allow-list: strong, em, a, br, span) to block XSS and layout changes.

## Statuses
- **Draft** — new or unpublished article; not on the website.
- **Published** — live. Editing a published article keeps the live version until the editor presses Publish again
  ("Unpublished changes" marker in the admin).
- No "In review", no "Scheduled".

## New article flow (slug)
1. Guides → **New guide** → the draft opens with the standard guide structure (safety note, Symptoms, Likely causes,
   What to check, When to call a TPS engineer, Ask LiveAccess, disclaimer). Status: Draft.
2. Type the title. Slug fills in automatically: lowercase, ASCII, hyphens
   (`Homogeniser pressure drop: causes & checks` → `homogeniser-pressure-drop-causes-and-checks`).
   Editable. Live check: must be unique, 3–80 chars, not reserved (`admin`, `api`, `images`, existing page names).
3. URL preview shows `liveaccess.ai/guide-<slug>.html` (keeps today's URL pattern; areas use `area-<slug>.html`).
4. Add summary, process area, blocks.
5. SEO tab: meta title (counter, 60), description (counter, 160), share image, Google + social preview.
6. Save draft → preview in the real guide design → **Publish**.
7. On publish: page built, card added to the Guides page, sitemap.xml and llms.txt updated.
8. If the slug of a **published** article changes, a 301 from the old URL is created automatically.

## Admin screens (all in the prototype)
1. Login (email + password, "show password", lockout message)
2. Dashboard (unpublished changes, drafts, new contact messages, last publish status, recent activity)
3. Pages: Home, About us, Contact, Features, How it works, FAQ, Privacy policy, Terms & conditions, Delete account, Get the app, Guides page, Process areas page — each with fields from the real page + SEO tab + history tab
4. Troubleshooting guides: list (search, Draft/Published filter) + article editor (blocks, slug, SEO, process area)
5. Process areas: same editor; related guides listed automatically
6. FAQ (questions edited on the FAQ page itself: add, move, remove; FAQPage JSON-LD is built from them)
7. Media library (upload, alt text, usage, replace)
8. Menus (header + 3 footer columns)
9. SEO & redirects (redirect list, sitemap/robots/llms.txt preview, default share image)
10. Contact inbox
11. Users & roles (Super Admin only)
12. Site settings (app links, analytics IDs, contact email)
13. Audit log
14. Publish centre (unpublished changes, publish history, failed checks)

## Roles
| Action | Super Admin | Editor |
|---|---|---|
| Edit pages/articles/FAQ/media | ✓ | ✓ |
| Publish | ✓ | ✓ |
| Menus, redirects, site settings | ✓ | — |
| Users & roles, audit log | ✓ | — |
| Contact inbox | ✓ | ✓ |

## Security (email + password only)
- argon2id hashes; min 12-character password; Super Admin can reset a user's password (no email reset until an
  email service exists).
- Session cookie: httpOnly, Secure, SameSite=Strict, 8-hour idle timeout; CSRF token on all writes.
- Login rate limit + lockout after 5 failed tries for 15 minutes; generic "email or password is wrong" message.
- Role check on every API route (server side, not only in the UI).
- Uploads: allow JPG/PNG/WebP only, max 10 MB, re-encoded by sharp, random file names.
- Inline HTML sanitised; all output escaped in templates.
- Admin served under `/admin` with `noindex`, blocked in robots.txt.
- Daily DB backup + media backup, 30-day retention.

## Phases and estimates (one developer, working days)
| # | Phase | Without AI | Claude Code + mm-skill |
|---|---|---|---|
| 0 | Wrap current client work, Lighthouse baseline, freeze content | 1–2 | 1–2 |
| 1 | Project setup, DB schema + migrations, auth, roles, audit log | 4–5 | 2–3 |
| 2 | Current 29 pages become templates; HTML diff = clean | 6–8 | 3–4 |
| 3 | Page editors (fields from template, SEO tab, history/restore) | 6–8 | 3 |
| 4 | Article editor (blocks, image position, slug, process area) for guides + areas | 6–8 | 3–4 |
| 5 | Media library + image pipeline | 3–4 | 1–2 |
| 6 | Menus, settings, redirects, contact inbox, users | 5–6 | 2–3 |
| 7 | Publish worker, checks, preview builds, publish centre | 4–5 | 2–3 |
| 8 | Content migration script (current HTML → DB), security pass, QA, training | 4–5 | 2–3 |
| | **Total** | **39–51 days (~8–10 weeks)** | **≈18–24 days (~4 weeks)** |

Hosting setup (1–3 days) is extra. AI estimates assume full-time work on this project and answers from Akash before
Phase 1. Removing review/schedule saves roughly 1 day in Phase 4.

## What the server must provide (for the hosting decision later)
- Node.js 20+ process (API + admin + publish worker), PostgreSQL 16, ~10 GB disk for media, HTTPS.
- Outbound FTP to the current host (or the public site moves to the same server later).
- Options: small VPS (DigitalOcean / Hetzner / Azure VM) or Azure App Service + Azure Database for PostgreSQL.

## Acceptance criteria
- The site looks exactly as today: same layout, CSS and URLs.
- Lighthouse mobile scores ≥ Phase 0 baseline; no admin JS on public pages.
- Every page's title, meta description, share image, canonical and noindex editable; JSON-LD generated from content.
- Editor can create a new guide with slug, images in all 4 positions and SEO, and see it live without a developer.
- Changing a published slug creates a working 301.
- Contact form submissions appear in the inbox.
- Every change recorded in audit log and restorable from history.
- GA4 tag `G-JFHJD3T51M` and cookie consent keep working on every page.

## Open questions for Akash
1. Confirm stack (Node/Fastify + React) and database (PostgreSQL), or does the company prefer SQL Server/Azure?
2. Hosting — where, and when can we decide?
3. Should Editors be allowed to change the Privacy policy and Terms, or Super Admin only?
4. Email service for contact notifications and password reset — available later?

## Deploy
Nothing is built or deployed in this step. No commits unless asked.
