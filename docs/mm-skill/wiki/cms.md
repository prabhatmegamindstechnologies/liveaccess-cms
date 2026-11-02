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

## Gotchas
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
pnpm test && pnpm typecheck
```
Schema changes: edit `cms/db/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate`.
