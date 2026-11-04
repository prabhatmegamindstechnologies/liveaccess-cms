# CMS: Audit log page, plus two account security decisions

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-04, Prabhat ("let implement audit log page ok So I can test that as well"), recommendations accepted
- Branch: feature/cms

## Done =
A Super Admin can open `/la-studio/audit` and read who did what and when, in plain language, with filters. Separately,
changes to Super Admins need the caller's own password, temporary passwords expire after 72 hours, and sessions end after
7 days at the latest.

## Brainstorm (2026-11-04, Prabhat: "use your recommendation")
1. Scope: **(a)** newest first, filters for user, type of action and date range, 50 per page, plain-language entries that
   link to the item where possible. No CSV.
2. Sign-ins and IPs: **(a)** sign-in activity sits behind a "Sign-ins" filter so content changes stay easy to read. Failed
   sign-ins always show. IP addresses only in an entry's details.
3. Retention: **(a)** keep everything, no delete in the admin panel. Decide a limit with Akash before go-live.

Security decisions from the Users & roles review, both **yes**:
- Ask for your own password when creating, promoting or resetting a Super Admin.
- Temporary passwords expire after 72 hours; sessions end after 7 days, even if active.

Changed after testing (Prabhat, 2026-11-04): a Super Admin can edit the temporary password. This replaces the read-only
box from Users & roles decision 1(a). See step 8.

## What exists today (checked 2026-11-04)
- `audit_log`: user, action, entity type and id, detail, ip, time. Local database: 95 entries from 2–4 Nov.
- Index on entity and time only, none for newest-first over the whole log.
- About 25 action names, some built from a template (`${kind}_edited`, `seo_${part}_edited`).
- `entityId` is a page key, an article id or a user id. Deleted guides keep their title in `detail`.
- `audit_log.user_id` is set to null if a user is removed, and unknown-email sign-ins have no user.
- `/audit` route and the Super Admin guard in the admin are in place, showing the placeholder.

## Plan
### Audit log
- [x] 1. **Database** migration `0005`: index on `audit_log.created_at`; `users.temp_password_expires_at` (step 5).
- [x] 2. **API** `cms/api/audit/routes.ts` (tests first), `GET /audit?page&user&group&from&to`, read-only, Super Admin only:
      - Filters validated; `group` is one of content, website, users, publishing, sign-ins, with a fixed list of actions.
      - Default view leaves out routine sign-ins and sign-outs, keeps failed and locked ones.
      - Returns entries with the user's name and the item's current title (pages, guides, areas, users), the total, and
        the users list for the filter. Queries stay parameterised.
      - `detail` is returned only through an allow-list of keys, and never `emailHash`.
- [x] 3. **Shared wording** `describeAudit(entry)` in `cms/admin/src/lib/audit.ts` (tests first): plain sentence per action, with a
      fallback that shows the raw action, so a new action still appears rather than vanishing.
- [x] 4. **Screen** `AuditLog.tsx` replaces the placeholder: filters, table (when, who, what), paging, "Details" row with the
      IP address and changed fields, links to the item. Filters live in the address, so a view can be shared and reloaded.

### Account security
- [x] 5. **Temporary passwords expire** after 72 hours (tests first): set on create and reset, cleared on change. Sign-in
      after that gets the usual "Email or password is wrong", so nothing is revealed. The Users list shows "Temporary
      password expired", and Reset password gives a new one.
- [x] 6. **Sessions end after 7 days** (tests first): `readSession` also refuses a session older than 7 days from
      `sessions.created_at`, however active. The 8-hour idle limit stays.
- [x] 7. **Own password for Super Admin changes** (tests first): `currentPassword` required on `POST /users` with the Super Admin
      role, `PATCH /users/:id` promoting to Super Admin, and `reset-password` on a Super Admin. Wrong password: 422, logged,
      nothing changes. Dialogs ask for it only in those cases. Limited to 5 tries a minute.
- [x] 8. **Editable temporary password** (Prabhat, 2026-11-04: "i want that we can edit them", tests first):
      - Add user and Reset password dialogs get a "Temporary password" field, filled in with a generated password that
        the Super Admin can change or regenerate **before saving**. The field moves there because the password is already
        saved by the time today's read-only box appears.
      - API: `POST /users` and `reset-password` accept an optional `password`, same rules (12 to 1,024 characters). If
        it's left out, the server still generates one. Typed or generated, it's temporary: the user must change it at
        first sign-in, and it expires after 72 hours.
      - The result dialog stays, for copying. The password is never stored in plain text or logged; the audit log only
        records whether it was typed or generated.
- [x] 9. **Docs:** wiki `cms.md`, and update the Security Gate in `2026-11-04-cms-users-roles.md`.

`session.ts` is shared by every signed-in request, so defensive-editing runs first (callers, contract, rollback).

Rejected: writing the sentence into each audit row when it's saved. It would freeze old wording and rename-sensitive
titles, and the 95 existing rows would need rewriting. The sentence is built when the entry is shown.
Rejected: page-by-cursor paging. It's faster on huge logs, but numbered pages are simpler and this log stays small for now.

## Verification
- `pnpm test`, `pnpm typecheck`, `pnpm build:admin`.
- API tests: Editor 403, no sign-in 401, filters, bad filter values, paging, hidden `emailHash`, IP only in details,
  entries with a missing user or a deleted item still show.
- Run on the local database: confirm the 95 existing entries read correctly, including every action name in use.
- Mandatory `security-gate` (with the independent `security-auditor`, as this touches sign-in and sessions) and
  `post-task-review`.

## Out of scope
- CSV download, deleting or expiring log entries.
- Go-live hardening logged in `2026-11-04-cms-users-roles.md` (shared rate limits, per-IP login limit, error logging).
- The page HTML guard fix (still required before real Publish).

## Rollback
New files plus small edits to `session.ts`, `auth/routes.ts`, `users/routes.ts`, `app.ts`, `schema.ts`, `main.tsx`, `UsersList.tsx`.
The migration only adds an index and a column, which can stay. Nothing is committed unless Prabhat asks.

## Changes from the plan
- The own-password check also covers disabling, enabling and demoting a Super Admin (found in review).
- Five wrong own-password tries end the session, as well as the 5-a-minute limit.
- `passwordSource` comes from the screen (the field is pre-filled, so the API can't tell by itself).
- Audit "Who" shows the email too, and renames log the old name.

## Security Gate
Status: PASSED, no BLOCKING findings (independent security-auditor, static review)
- ✅ Audit API: auth, filters, allow-list, links and XSS clean. Expiry, typed passwords and the session limit clean.
- ✅ Fixed after review: re-enable/disable/demote gap; parallel guesses; rename rewriting history; query values in server logs;
  password source always "typed"; 0005 backfills expiry.
- 🟡 Before go-live: content changes don't record an IP (only user actions and sign-ins do). Own-password limiter is in memory.

## Code Review
Status: APPROVED
- ✅ All plan steps done, tested, and every action in the local log has a sentence and a group.
- 🟡 SUGGESTION: the list of actions lives in both `audit/routes.ts` and `lib/audit.ts`.
