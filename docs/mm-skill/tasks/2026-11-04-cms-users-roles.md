# CMS: Users & roles

- Flow: FEATURE
- Status: done (not committed)
- Requested: 2026-11-04, Prabhat ("lets implement users and roles page from in the app")
- Branch: feature/cms

## Done =
A Super Admin can add, edit, disable and re-enable users, reset passwords and unlock accounts at `/la-studio/users`, and
every user can change their own password. The rules are enforced by the API, not only hidden in the screen.

## Brainstorm
The four questions weren't answered individually ("lets implement"), so the recommended options are used. Edit this
section if any should change.
1. First password: **(a)** the CMS creates a temporary password, shown once. The user must change it at first sign-in.
   Reset works the same way. Rejected: admin types it (they keep knowing it); email invite (no email service).
2. Own password: **(a)** yes, "Change password" by the user's name, current password needed.
3. Someone leaves: **(a)** disable only, no delete. Their name stays on past edits and in the audit log.
4. Editor limits: **changed from what was recommended in chat.** The approved Roles table in
   `2026-10-30-custom-admin-panel.md` says Menus, redirects, Site settings, Users & roles and Audit log are Super Admin
   only, and the recommended 4(a) contradicted it. The plan follows the approved table. See step 4.
   Whether Editors can change Privacy/Terms stays an open question: no change here.

## What exists today (checked 2026-11-04)
- `users` table has role, status, lockout fields. Login, argon2id, sessions and disabled-user refusal are done and tested.
- `readSession` already refuses disabled users, so disabling takes effect on the next request.
- `requireUser` is the one middleware every route uses, so a forced password change can be enforced there.
- Only Site settings checks the role. **Editors can save Menus and SEO today, against the approved table.**
- One user exists: `admin@example.com`, Super Admin.

## Plan
- [x] 1. **Database** migration `0004`: `users.must_change_password` (boolean, default false). Additive; existing users
      keep working. `pnpm db:migrate` runs on the local database.
- [x] 2. **API** `cms/api/users/routes.ts` (tests first), all Super Admin only (403 for Editors), CSRF, rate limited:
      - `GET /users`: name, email, role, status, locked, last sign-in. Never password data.
      - `POST /users` `{ name, email, role }` → user + temporary password, returned once, never stored or logged.
      - `PATCH /users/:id` `{ name?, email?, role?, status? }`; email unique (409), case-insensitive.
      - `POST /users/:id/reset-password` → new temporary password; also unlocks. `POST /users/:id/unlock`.
      - Rules, checked in a transaction with row locks so two admins can't remove each other at the same moment:
        the last active Super Admin can't be disabled or demoted; you can't disable or demote yourself, or reset your
        own password here (use Change password).
      - Role change, reset or disable ends that user's sessions. Every action goes in the audit log, without passwords.
- [x] 3. **Own password** `POST /auth/change-password` `{ currentPassword, newPassword }` (tests first): current password
      required, min 12, max 1024, must differ, limited to 5 tries a minute, ends the user's other sessions.
      `requireUser` refuses everything else (403, `passwordChangeRequired`) while `must_change_password` is set, so a
      temporary password can't be used for real work. `/auth/me`, `/auth/logout` and change-password stay open.
      `pnpm db:seed-admin` clears the flag.
- [x] 4. **Role limits from the approved table:** saving Menus and all of SEO & redirects becomes Super Admin only (403),
      like Site settings. Editors can still open them read-only (`canEdit: false`). Existing tests that save as an
      Editor change to a Super Admin, and each screen gets a 403 test.
- [x] 5. **Admin screens:**
      - `UsersList.tsx`: table, Add user, Edit, Reset password, Unlock, Disable/Enable with a confirmation step.
      - Temporary password dialog: shown once, copy button, warning that it can't be shown again.
      - `ChangePassword.tsx`: link by the user's name; also the only screen shown during a forced change.
      - Sidebar hides Users & roles and Audit log for Editors; opening the address shows "Super Admins only".
      - Menus and SEO screens become read-only for Editors with a short note.
- [x] 6. **Docs:** wiki `cms.md`.

Rejected: a role check inside each route handler (easy to forget on a new route). A small `requireSuperAdmin` middleware
covers the users routes as a whole.

## Verification
- `pnpm test`, `pnpm typecheck`, `pnpm build:admin`.
- API tests per rule: Editor 403 on every users route, last Super Admin, self-protection, simultaneous demotion,
  sessions ended, temporary password refused for normal work, no password data in responses or the audit log.
- Run on the local database: create an Editor, sign in, forced change, confirm Editor limits.
- Mandatory `security-gate` (with the independent `security-auditor`, as this is auth code) and `post-task-review`.

## Out of scope
- Email invites and "forgot password" (no email service). A locked-out last Super Admin uses `pnpm db:seed-admin`.
- Deleting users, 2FA, SSO, the Audit log screen.
- The page HTML guard fix (still required before real Publish).

## Rollback
New files plus small edits to `require-user.ts`, `auth/routes.ts`, `app.ts`, menus and SEO routes, `Shell.tsx`, `main.tsx`.
The migration only adds one column, and can stay if the code is removed. Nothing is committed unless Prabhat asks.

## Security Gate
Status: PASSED, no BLOCKING findings (independent security-auditor, static review: races not reproduced)
- ✅ Editors and temporary-password users can't reach privileged actions. No mass assignment. Temporary password: random,
  shown once, not in logs or the audit log. Enumeration, CSRF and error messages clean.
- ✅ Fixed after review: every users change takes the same locks and re-checks the caller (also removes the
  reset/PATCH deadlock); change-password can't overwrite a reset; seed-admin ends sessions; an email change ends sessions and
  logs both addresses; users actions record the IP.
- ✅ Decided 2026-11-04, built in `2026-11-04-cms-audit-log.md`: own password for Super Admin changes, 72-hour temporary
  passwords, 7-day session limit.
- 🟡 Before go-live (Day 6): failed change-password tries count toward lockout; shared, not in-memory, rate limits; per-IP
  login limit; a login racing a password change can keep a session.
- 🟡 `pnpm audit` not re-run by the auditor. No new dependencies were added.

## Code Review
Status: APPROVED
- ✅ All plan steps done, rules enforced in the API and tested, role limits match the approved table.
- 🟡 SUGGESTION: the change-password race and caller re-check have no test that forces the timing.
