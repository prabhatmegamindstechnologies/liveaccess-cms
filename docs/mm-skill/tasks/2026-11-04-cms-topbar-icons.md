# CMS: icons in the top bar

- Flow: SMALL_TASK
- Status: done
- Requested: 2026-11-04, Prabhat ("show here proper icon instead of long text here", screenshot with Change password and Sign out boxed)
- Branch: feature/cms

## Done =
The top bar shows icons for Change password and Sign out instead of text, and both still work.

## Brainstorm
N/A (SMALL_TASK, no brainstorm)

## Plan
- [x] 1. `cms/admin/src/components/Shell.tsx`, top bar only:
      - Change password: the same key icon as Reset password on Users & roles, so one icon means "password" everywhere. Move
        `KEY` from `UsersList.tsx` to `ui.tsx` to share it.
      - Sign out: a door with an arrow pointing out, with no border, like the other icons.
      - Both use `LineIcon` and `iconBtn`. Hovering shows "Change password" or "Sign out", and screen readers hear the same.
      - The user's name, role and initials stay as they are.
- [x] 2. Security gate (3-point) and post-task review.

Rejected: a dropdown menu under the user's name. It's tidier with many options, but there are only two, and it adds a click.
Rejected: keeping the Sign out border. The other icon actions have none.

## Verification
- `pnpm typecheck`, `pnpm build:admin`, `pnpm test`.
- Check both in a browser, if one is available here. Otherwise Prabhat checks them.

## Rollback
`git restore` the changed files, or `git revert` if committed.

## Security Gate
Status: PASSED
- ✅ No secrets in the changed lines. No injection risk (fixed markup only). Sign out still calls `logout`; no control touched.

## Code Review
Status: APPROVED
- ✅ Same link target and sign-out handler; `KEY` shared from `ui.tsx`, so Users & roles keeps the same icon.
- ✅ Typecheck and admin build clean; 312 tests pass (shared 107, cms 205). No test covers this layout.
- 🟡 Not checked in a browser by me. Prabhat to confirm.