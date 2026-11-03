# CMS Day 2 — Admin shell, login screen, page editor with live preview

- **Flow:** FEATURE (Day 2 of 8, plan v3.1: https://claude.ai/artifact/UZJy25p3EXk3SEdQDXvF6U)
- **Date:** 2026-11-02
- **Branch:** `feature/cms` (Day 1 = `391042b`)
- **Builds on:** `docs/mm-skill/tasks/2026-11-02-cms-day1-foundation.md`, wiki `docs/mm-skill/wiki/cms.md`
- **Status:** Implemented on `feature/cms` (not committed) — security gate in progress

## Done =
At `http://localhost:5173/la-studio` an editor signs in, sees the 12 pages, opens any page (incl. Privacy and Terms),
edits text, images and repeating items in fields read from the real page while a live preview shows the real page
with its own CSS, changes auto-save as a draft (`pages.html`) while the live version (`published_html`) stays
unchanged, a stale save is refused with a "changed by someone else, reload" message, SEO fields and version history
(with restore) work — all backed by tested `/la-studio/api/pages` routes, with the security gate passed.

## Brainstorm — confirmed answers (2026-11-02)
| Question | Answer |
|---|---|
| Admin path | `la-studio` for now |
| Who can edit Privacy / Terms | **Editors and Super Admins** (no role restriction on pages) |
| Styling | **Tailwind**, built fresh (not the prototype CSS). Keep the prototype's agreed UX: back button above the title, Save/Publish area on the right of the title row, description under the title, 28px gap between editor and preview, no overlap at 1366px. |
| Saving | **Auto-save** a few seconds after the last change |
| Two people on one page | **Version check**: a save based on an old version is refused (409) with "This page was changed by <name> at <time>. Reload to see their changes." Nothing is overwritten silently. |
| Draft vs live | Saves go to `pages.html` (draft). `published_html` stays as is until Publish (Day 4). The list and editor show "Unpublished changes" when they differ. |
| Vercel / Neon / DNS | Later (needed before Day 6) |

## Plan (checklist)
- [x] 1. DB: migration `0001` adds `version integer not null default 1` to `pages` and `articles`.
- [x] 2. `packages/shared/src/fields.ts`: port the prototype's field logic (tests first, with linkedom + the real pages).
- [x] 3. API: auth middleware + `/la-studio/api/pages` routes + preview asset route (tests first).
- [x] 4. Admin app `cms/admin/` (Vite + React + TypeScript + Tailwind): login, shell, pages list, page editor
      (Content / SEO / History), live preview, auto-save with conflict handling.
- [x] 5. Verify: all tests, typecheck, build, headless-Edge smoke test of login → edit → auto-save → reload.
- [ ] Security gate (integration, + security-auditor: auth + HTML input)
- [ ] Code review
- [ ] Wiki update (`cms.md`: API contract, admin dev commands)

## API (all need a signed-in Super Admin or Editor; writes also need `X-CSRF-Token`)
| Method + path | Does |
|---|---|
| `GET /la-studio/api/pages` | List: key, title, url, version, hasChanges (`html <> published_html`), updatedAt, updatedBy name |
| `GET /la-studio/api/pages/:key` | One page: draft `html`, SEO fields, version, hasChanges |
| `PUT /la-studio/api/pages/:key` | Save draft: `{ baseVersion, html?, seo? }`. 409 if `baseVersion` ≠ current (body names who saved and when). Returns the new version. |
| `GET /la-studio/api/pages/:key/revisions` | Version history (newest first): when, who, note |
| `POST /la-studio/api/pages/:key/revisions/:id/restore` | Loads that version as the draft (with version check); adds a revision |
| `GET /la-studio/api/preview-assets/*` | Serves the site's CSS, fonts and images from `SITE_ROOT` for the preview (dev only; production uses the site itself on the same domain) |

**Server-side guard on saved page HTML** (layout lock and security, not only in the UI):
- max 1 MB (the pages route gets its own body limit; the global 64 KB stays for everything else);
- the `<script>` elements must be exactly the same as in the published version (no added, removed or changed scripts),
  so GA4 `G-JFHJD3T51M` and the consent script can't be lost or injected;
- no `on*=` event attributes and no `javascript:` URLs anywhere;
- the `<head>` may only differ in `<title>`, meta description, canonical and robots.
  Anything else → 422 with a plain message.

**Revisions with auto-save:** a revision is written when the page's last revision is older than 10 minutes or was made
by someone else — so history shows meaningful versions, not one row per keystroke. Restore always writes one.

**SEO tab:** saves `seo_title`, `seo_description`, `canonical`, `noindex` columns. The build (Day 4) writes them into
`<head>`; the SEO tab shows Google and social previews from these values.

## Shared field logic (`packages/shared/src/fields.ts`)
Ported from the prototype (tested there in a real browser). Works on any DOM (iframe document in the admin,
linkedom in tests):
- `buildFields(doc)` → text, text-node and image fields inside `<main>` (skips header, footer, breadcrumbs, scripts,
  hidden/visually-hidden text, the legal table of contents), each with its section, its repeating item (if any) and
  a label (Main heading, Heading, Intro text, List item, Question, Answer, Button text, Image…).
- `writeField(field, value)` → sanitises with `sanitizeInline`, keeps the leading `<span class="num">` on legal headings,
  keeps the table of contents in sync.
- `moveItem / removeItem / addItem` → repeating items (cards, rows, list items, FAQ questions); a new item is a copy.
- `serialize(doc)` → full HTML without editor-only attributes or preview styles; scripts are put back from the original.
  (The preview never runs page scripts: they are removed before display and restored on save.)

## Admin app (`cms/admin/`)
- Vite + React + TypeScript + Tailwind; React Router for `/la-studio/login`, `/la-studio/pages`,
  `/la-studio/pages/:key` (tabs: Content, SEO, History). Dev server on `localhost:5173` proxies `/la-studio/api` to
  the API on `8787`.
- **Shell:** sidebar (Pages active; other sections shown as "Coming on Day N"), top bar with breadcrumb (clickable),
  signed-in user and Sign out.
- **Login:** email + password, show/hide, generic error, lockout message.
- **Pages list:** status and "Unpublished changes" chip, last edited by/at.
- **Page editor:** "← Back to Pages", title row with save status on the right ("Saving…", "Saved 10:42",
  "Couldn't save — retrying", "Changed by someone else"), fields on the left (grouped by section, repeating items with
  ↑ ↓ ✕ and "+ Add another"), live preview on the right (real page, own CSS, Desktop/Mobile, click text → jumps to its
  field, focus field → highlights in preview).
- **Preview iframe:** `srcdoc` + `sandbox="allow-same-origin"` (no `allow-scripts`, so page code can't run in the admin);
  `<base href>` points at the preview-asset route in dev and `/` in production.
- **Auto-save:** 2 s after the last change (at most every 10 s while typing), and when the tab is hidden or you leave
  the page; warns before closing the tab if a save is still pending; on 409 stops saving and shows a Reload banner.
- **SEO tab:** title / description with character counters, canonical, noindex, Google + social preview.
- **History tab:** list of versions with Restore.

## Tests (written first)
- `fields.test.ts` (real `about.html`, `how-it-works.html`, `privacy-policy.html`, `faq.html`): fields found per section;
  the About `h1` value keeps `<em>`; writing a field changes only that element; adding a `.fact` item adds a copy;
  moving/removing compare-table rows; Privacy heading keeps `<span class="num">` and updates the table of contents;
  `serialize` removes `data-cms-*` and preview styles and restores the original scripts byte-for-byte.
- `pages.test.ts`: 401 without session; list returns 12, `hasChanges` false after import; save with the right version →
  200, version +1, `published_html` unchanged, `hasChanges` true; stale version → 409 naming the other user; missing CSRF
  → 403; added `<script>`, removed GA4, `onclick`, `javascript:` → 422; SEO save; two quick saves → one revision;
  restore; preview-assets serves `common.css`, refuses `../`, `.env`, `.ts`, `.html` outside the allow-list.
- Admin: `useAutosave` hook (fake timers): debounce, max wait, stops after 409, flush on hide.
- Smoke (headless Edge): sign in → open About → change the heading → wait for "Saved" → reload → change still there,
  live HTML unchanged.

## Rejected alternatives
- **Storing page content as JSON fields** instead of HTML — would need a template per page; storing the page HTML and
  editing it in place is what guarantees the layout lock.
- **Running page scripts in the preview** — no value for editing and a risk; the iframe has no `allow-scripts`.
- **Revision per auto-save** — floods history; 10-minute / other-user rule instead.
- **TanStack Query / Redux** — not needed for this size; small fetch helper + React state.

## Things I'm going from memory (verify on install)
Tailwind v4 with the `@tailwindcss/vite` plugin and `@import "tailwindcss"`; React 19; React Router 7 package name
`react-router`; Vite's `server.proxy`. pnpm's 7-day cooldown will pick the versions.

## Risks
- Day 2 is the biggest day (shared logic + API + whole admin shell). If it runs over, the History tab moves to Day 3
  morning; everything else stays.
- Preview fonts/images in dev come through the API asset route; checked in the smoke test.

## Deploy
Nothing is deployed. Commit on `feature/cms` only when you ask.

## Implementation log (2026-11-02)
- Migration `0001_smart_vindicator.sql`: `version` on `pages` and `articles`.
- `packages/shared/src/fields.ts`: prototype logic ported (`splitScripts`/`joinScripts`, `buildFields`, `writeField`,
  `setImageAlt`, `moveItem`/`removeItem`/`addItem`, `serialize`). No linkedom import, so it also runs in the browser.
- API: `requireUser` middleware (session + CSRF on writes), `/pages` routes (list, one, PUT with `SELECT … FOR UPDATE`
  version check, revisions, restore), `guard.ts` (scripts identical to published, no `on*`, no `javascript:`, head only
  title/description/robots/canonical, 1 MB), dev-only `preview-assets` (extension + folder allow-list, auth required).
  Page PUT gets a 1.5 MB body limit; everything else stays at 64 KB. Auth routes now reuse `sameToken`.
- Admin (`cms/admin`, Vite 8 + React 19 + React Router 8 + Tailwind 4): Login, Shell (later sections show "Day N"),
  Pages list, Page editor (Content / SEO / History), LivePreview (sandboxed iframe, scaled, desktop/mobile,
  click-to-field), FieldList (sections, repeating items ↑ ↓ ✕ + Add another), auto-save controller.
- Versions differ from my guess: React Router is 8.5.0 (not 7); Vite 8.3.5. Tailwind v4 + `@tailwindcss/vite` as expected.
- TDD: fields and pages API tests ran RED first, then GREEN. The auto-save tests were written together with the code.

## Verification (2026-11-02)
- `pnpm test`: shared 27/27, cms 51/51 (auth 16, password 4, import 7, pages 18, autosave 6).
- `pnpm typecheck`: shared, cms API and cms admin clean. `pnpm build:admin`: 18 KB CSS, 93 KB JS gzip.
- E2E in headless Edge (DevTools protocol, temporary user `smoke@example.com`, deleted afterwards):
  12 pages listed; About editor 16 fields; preview font "Plus Jakarta Sans", highlight `rgb(232, 84, 26)`, 0 scripts in
  preview; heading edit shows in the preview at once; "Saved 07:16 PM" + "Unpublished changes"; click on preview text
  focuses its field; draft survives reload; a save by someone else → banner "This page was changed by Smoke Test at …".
  DB after: version 3, draft changed, `published_html` unchanged. About draft reset to the live HTML afterwards.
- Screenshot checked: fields left, real page right, 28px gap, no overlap at 1440px.

## Add-on (2026-11-02, Prabhat): collapse / expand
Requested while testing the FAQ editor ("let add collapse and expand options").
- [x] **Sidebar:** a `«` / `»` button next to "LiveAccess Admin". Collapsed = narrow rail with short labels/initials
      and tooltips, so the editor and preview get more room. Choice remembered in `localStorage` (falls back to expanded).
- [x] **Editor sections:** each section card header (e.g. "Questions we get asked.", "1. Information We Collect")
      toggles that card open/closed; "Collapse all" / "Expand all" above the fields. Default: all open.
      Clicking text in the preview opens its section, then focuses the field. Hidden fields stay in the DOM
      (only visually collapsed), so auto-save and the field ↔ preview link keep working.
- [x] Tests: section collapse state + "open on preview click" covered in the headless-Edge E2E (FAQ and Privacy);
      sidebar toggle + remembered state checked there too. Typecheck and build.
- Not changed: API, database, saving, layout lock.
- Verified (headless Edge, 1440px): FAQ 3 sections open → Collapse all → 0 visible (36 inputs still in DOM) →
  click "Is LiveAccess free?" in preview → 1 section opens, that field focused → Expand all → 3 → header toggle → 2,
  `aria-expanded="false"`. Privacy: Collapse all → click "Your Rights…" heading → 1 section open, field focused.
  Sidebar 240px → 64px (labels "D P TG PA F") → stays collapsed after reload → 240px. Only FAQ highlighted on /pages/faq.
  Typecheck clean, admin build OK. No drafts changed; test user removed.
