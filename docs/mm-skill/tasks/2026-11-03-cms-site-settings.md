# CMS: Site settings section

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-03, Prabhat ("implement the site setting from the [prototype]")
- Branch: feature/cms

## Request
Build `/la-studio/settings` like the prototype's "Site settings" screen (cards: General, App links, Contact, Analytics).

## Prototype screen (proto2-template.html, vSettings)
- General: Site name, Footer tagline.
- App links: App Store URL, Google Play URL ("used by every store badge, the QR redirect and the footer").
- Contact: Public contact email, "Send new contact messages to" (email alerts need an email service, later).
- Analytics: Google Analytics 4 ID ("currently G-JFHJD3T51M on every page"), Google Tag Manager ID (optional).
- Prototype role table: "Menus, redirects, site settings" = Super Admin only (Editor no).

## What exists today (checked 2026-11-03)
- App Store `https://apps.apple.com/app/liveaccess-24-7/id6790754198` (23 places); Google Play
  `https://play.google.com/store/apps/details?id=com.liveaccess.app` (23 places, most with a per-page
  `&referrer=utm_source=website&utm_campaign=…`). See wiki `mobile-app-links.md`.
- Contact email `liveaccess@tps.ltd` (mailto links, some with a subject).
- GA4 `G-JFHJD3T51M` on every page (82 hits). Standing rule: never remove this tag; GTM goes alongside it.
- Footer tagline: "The 24/7 service app from TPS for dairy, food and beverage plants."
- Site name already lives in SEO & redirects → Defaults (`seo.defaults.siteName`).
- `settings` table (key → jsonb) exists; SEO drafts already use it.

## Brainstorm (answers 2026-11-03, Prabhat)
1. Site name (already in SEO Defaults): no answer → recommendation (a): **site name moves here** and is removed from
   SEO & redirects → Defaults (one place to edit it).
2. Who can edit: **Super Admin only** (Site settings). Editors can open the screen read-only. Menus and SEO unchanged.
3. Analytics: **GA4 ID required**, format `G-XXXXXXXX`, can be changed but never emptied; GTM optional
   (`GTM-XXXXXXX`), added alongside GA4, never instead of it. → yes
4. App links: **only real App Store (apps.apple.com) and Google Play (play.google.com) addresses**. Publish keeps
   the per-page `referrer`/utm part of the Play links and changes only the base link. → ok
5. Contact: alert email **saved now, alerts later** (screen says so). Save button, draft only, like the other sections.

## Plan
- [x] 1. **Shared** `packages/shared/src/site-settings.ts` (tests first): `SiteSettings` type and
      `validateSiteSettings()`:
      - siteName 1–60, footer tagline 1–200 (plain text, no hidden characters).
      - App Store: `https://apps.apple.com/…` (any path, safe https); Google Play:
        `https://play.google.com/store/apps/details?id=…` (safe https). Stored normalised.
      - Public email and alert email: one valid address each (max 254, no spaces/quotes/`<>`), alert email optional.
      - GA4 `^G-[A-Z0-9]{6,12}$` required (upper-cased); GTM `^GTM-[A-Z0-9]{4,10}$` optional.
- [x] 2. **Data**: settings row `site.settings` = `{ value, version, updatedBy, updatedAt }` (same shape as SEO).
      First open → read from the live home page and the Play/App Store links on it, `liveaccess@tps.ltd`, the footer
      tagline and the GA4 id; GTM empty. No migration.
- [x] 3. **API** `/la-studio/api/settings`, tests first:
      - `GET /` (any signed-in user) → value, version, last edited by/at, `canEdit` (Super Admin).
      - `PUT /` `{ baseVersion, value }` → **Super Admin only (403 for Editors)**; 409 "changed by X"; 422 field
        errors; audit entry; save limit. No page HTML touched.
- [x] 4. **SEO Defaults**: remove `siteName` from `validateDefaults`, the API seed and the Defaults tab (tests updated).
- [x] 5. **Admin screen** `/la-studio/settings` (replaces the coming-soon page): 4 cards as in the prototype
      (General, App links, Contact, Analytics) + Save (saved pill, field errors, conflict banner, unsaved warning).
      Editors see the values read-only with a note "Only a Super Admin can change site settings."
- [x] 6. Verify: tests, typecheck, build, headless Edge (Super Admin edit/save/reload, bad GA4 / store link / email
      refused, empty GA4 refused; Editor read-only and 403 on save) and DB check that no page HTML changed.
- [x] Security gate · [x] Code review · [x] Wiki update (`cms.md`, `mobile-app-links.md`: links now edited in Site settings
      once Publish exists)

**Not in this task:** applying settings to pages (Publish centre); sending alert emails (email service later).

## Log
- 2026-11-03: plan approved ("yes"). `site-settings.ts` tests first (RED: module missing → GREEN 4/4).
- Site name removed from SEO Defaults (`validateDefaults`, seed, Defaults tab, tests) with a pointer "The site name
  is edited in Site settings."
- `cms/api/versioned-setting.ts` (`saveVersioned`, `editorNames`) extracted from the SEO routes and reused by
  `cms/api/settings/routes.ts`; SEO tests still green.
- Seed: the home page has no mailto link, so the email comes from the first page that has one (test caught it).

## Verification
- Tests: shared 59/59 (site settings 4), cms 87/87 (site settings API 7). Typecheck clean, admin build OK.
- Headless Edge, Super Admin: starts with LiveAccess / footer tagline / both store links / liveaccess@tps.ltd /
  G-JFHJD3T51M; Save disabled until a change; empty GA4 + look-alike App Store host + "nope" email → 3 field errors;
  fixed + alert email + "gtm-ab12cd" → "Saved"; reload shows alerts@tps.ltd, GTM-AB12CD, G-JFHJD3T51M.
- Headless Edge, Editor: note "Only a Super Admin can change site settings…", no Save button, fields read-only;
  direct PUT → 403.
- DB: pages + articles content hash identical before/after. Test row and both test users removed.

## Security Gate
Status: PASSED (checklist + security-auditor agent, 2026-11-03)
Findings:
- ✅ Super Admin only on save (role from the session, checked before the body; Editor 403 tested); CSRF + Origin
  check; save limit; 64 KB body limit; no new dependencies; no secrets.
- ✅ Store links https-only with exact hosts; GA4/GTM strict patterns (safe in script URLs); hidden characters refused.
- 🟡→✅ mailto header injection (`x?bcc=spy@…`, `%0A`) → email limited to `A-Z a-z 0-9 . _ + -` before `@`. Tests.
- 🟡→✅ Play link allowed extra query/fragment → only `?id=…`, no fragment (Publish adds each page's referrer). Tests.
- 🟡→✅ seed `decode` now handles `&amp;` last.
- 🟡 For Publish: HTML-escape siteName/tagline in text, attributes and JSON-LD (`<` as `<`); escape `&` in
  store link queries and the email.

## Code Review
Status: APPROVED
Notes:
- ✅ Matches the prototype's 4 cards; GA4 can't be emptied; Super Admin only; Editors read-only; drafts only.
- ✅ Reuse: `versioned-setting.ts` shared by SEO and settings; form pieces from `components/form.tsx`.
- ✅ Tests: shared 61 (site settings 6), cms 87 (site settings API 7); E2E as both roles; DB unchanged.
- 🟡 SUGGESTION: Menus and SEO still allow Editors (as planned); revisit if the prototype's role table should apply there too.
