# CMS: Dashboard

- Flow: FEATURE
- Status: done
- Requested: 2026-11-04, Prabhat ("let implement dashboard", with a screenshot of the placeholder)
- Branch: feature/cms

## Done =
`/la-studio/dashboard` shows real recent edits, drafts waiting to be published and new messages, instead of the "coming
soon" placeholder.

## What exists today (checked 2026-11-04)
- The approved spec (`2026-10-30-custom-admin-panel.md`, screen 2) lists: unpublished changes, drafts, new contact messages,
  last publish status, recent activity.
- `/dashboard` is a `ComingSoon` route in `cms/admin/src/main.tsx`. Signing in lands on `/pages`.
- Drafts: `pages` (`html` vs `publishedHtml`) and `articles` (`published`, null means never published) hold what's needed.
- Messages: the `contact_messages` table exists, but no API code reads or writes it. The Contact inbox isn't built.
- Publishing: the `publish_jobs` table exists, but real Publish isn't built, only the local preview.
- Recent activity: `audit_log`, but `/audit` is Super Admin only, and the Dashboard is open to Editors too.

- "Changed" already has two rules: `changed` in `cms/api/pages/routes.ts` (SQL) and `hasChanges` in
  `cms/api/articles/routes.ts` (compares a snapshot with `published`). The Dashboard must reuse them, or its counts could
  disagree with the Pages and guides lists.
- Audit wording and titles exist already: `describeAudit` (`lib/audit.ts`) and `itemsFor` (`api/audit/routes.ts`).

## Brainstorm (2026-11-04, Prabhat: "use your recommendation")
1. Messages and last publish: **(a)** show both now with an honest empty state; they fill in once those features exist.
2. Recent activity: **(a)** everyone sees the latest content edits to pages, guides and areas, with who and when. No IP
   addresses, sign-ins or user changes. Super Admins also get a link to the full Audit log.
3. Waiting to be published: **(a)** pages, guides and areas in one list, labelled "New" or "Changed", the 10 most recently
   edited, each linking to its editor, with a total and a link to Publish centre.
4. Landing page: **(a)** open the Dashboard after sign-in.

## Plan
- [x] 1. **Shared rules:** export `changed` (pages), `hasChanges` (articles) and `itemsFor` plus the content action list
      (audit), so the Dashboard reuses them. No change in behaviour.
- [x] 2. **API** `cms/api/dashboard/routes.ts` (tests first), `GET /dashboard`, read-only, any signed-in user:
      - `waiting`: the 10 most recently edited items (kind, title, link, "new" or "changed", when, who) and totals.
      - `activity`: the 10 latest content entries only (action, when, who's name, item). Never IP, email or `detail`
        beyond the kept title of a deleted item.
      - `messages`: the count of `contact_messages` with status `new`.
      - `lastPublish`: the latest `publish_jobs` status and time, or null.
- [x] 3. **Screen** `cms/admin/src/screens/Dashboard.tsx` replaces the placeholder:
      - Top row: Waiting to publish, New drafts, New messages, Last publish.
      - Below: "Waiting to be published" list with a link to Publish centre, and "Recent activity" using `describeAudit`,
        with a link to the Audit log for Super Admins only.
      - Empty states: "No messages yet", "Nothing published yet", "Everything is published".
- [x] 4. **Landing page:** `Login.tsx` (2 places) and the `main.tsx` index and fallback routes go to `/dashboard`. Remove the
      Dashboard entry from `SOON`. The forced password change still comes first.
- [x] 5. **Docs:** wiki `cms.md`.
- [x] 6. Security gate (independent `security-auditor`, as Editors get a new view of audit data) and post-task review.

Rejected: Editors calling `/audit` with a content filter. It would open the Super Admin route and everything it returns to
Editors. A separate, narrower route can't leak IP addresses or sign-ins.
Rejected: a stored "has changes" column. It needs a migration and could fall out of step with the lists. There are only a
few dozen items, so comparing them on each load is fine.

## Verification
- `pnpm test`, `pnpm typecheck`, `pnpm build:admin`.
- API tests: no sign-in 401; Editor and Super Admin 200; no IP, email or sign-in entries in the response; New and Changed
  labels match the lists; published items left out; limit of 10 with the right totals; empty states; deleted items still show.
- Run against the local database and compare the totals with the Pages and guides lists.
- Check the screen in a browser, if one is available here. Otherwise Prabhat checks it.

## Out of scope
- Building the Contact inbox or real Publish.
- Unpublished changes to Menus, SEO and Site settings. Only pages, guides and areas are listed, as agreed.
- The page HTML guard fix (still required before real Publish).

## Rollback
New route and screen plus small edits to `app.ts`, `main.tsx`, `Login.tsx` and the three exports. No migration.
`git revert` the commit, or `git restore` before committing.

## Changes from the plan
- The messages tile says "No new messages", not "No messages yet": it counts new messages only, so it stays true later on.
- Security review fixes: extra Editor test, note on `CONTENT_ACTIONS`, own-property check in `itemsFor`.

## Security Gate
Status: PASSED, no BLOCKING findings (independent security-auditor, static review)
- ✅ Editors get no IP, email, sign-in or user entries, message content or publish logs. Links are built from fixed prefixes.
- ✅ Auth covers the whole route, including the forced password change. `pnpm audit`: 1 moderate, no high or critical.
- ✅ Fixed after review: Editor leak test on the raw response; `CONTENT_ACTIONS` note; `Object.hasOwn` in `itemsFor`.
- 🟡 Before go-live: GET routes have no rate limit (true of every route, already on the go-live list).

## Code Review
Status: APPROVED
- ✅ All plan steps done. Reuses `changed`, `hasChanges`, `itemsFor` and `describeAudit`, so counts and wording match.
- ✅ Typecheck and admin build clean; 312 tests pass (shared 107, cms 205).
- ✅ Local database: Dashboard total 7 equals the lists (pages 4, guides 2, areas 1); 3 new drafts; 0 messages; no publish yet.
- 🟡 Screen not checked in a browser by me. Prabhat to confirm.