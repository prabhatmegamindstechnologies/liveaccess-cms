# CMS: pencil icon for Edit on the lists

- Flow: SMALL_TASK
- Status: done
- Requested: 2026-11-04, Prabhat ("let use proper icon here instead of edit text use pencil icon and show proper label here", with a screenshot of Pages)
- Branch: feature/cms

## Done =
Each row on the Pages list has a pencil icon instead of the "Edit" text, and the column has a visible "Actions" heading.
Troubleshooting guides and Process areas match.

## Brainstorm
N/A (SMALL_TASK, no brainstorm)

## Assumption
"Proper label" means the column's heading, which is blank today (`PagesList.tsx:28`), plus a label on the icon itself. The
screenshot's red box covers that blank heading and the Edit buttons.

## Plan
- [x] 1. `components/ui.tsx`: a small shared `EditLink` with the pencil icon. Hovering shows "Edit", and screen readers hear
      "Edit About us", so each row's link stays clear without the text.
- [x] 2. `PagesList.tsx`: use `EditLink`, and add a right-aligned "Actions" heading.
- [x] 3. `ArticlesList.tsx`: the same, as Guides and Process areas use the same button and blank heading.
- [x] 4. Security gate (3-point) and post-task review.

- [x] 5. Follow-up (Prabhat, 2026-11-04: "show here icon as well", screenshot of the Audit log with Clear and Details boxed),
      in `AuditLog.tsx`:
      - Details: an eye icon instead of the text, styled like the pencil. It's highlighted while the row is open. The screen
        reader label and `aria-expanded` stay, and hovering shows "Details".
      - The blank last column gets the same right-aligned "Actions" heading.
      - Clear: an X icon instead of the text, sized to line up with the filters. Hovering shows "Clear filters", and it stays
        faded while there's nothing to clear.

- [x] 6. Follow-up (Prabhat, 2026-11-04: "here also need icon as well", screenshot of Users & roles), in `UsersList.tsx`.
      This replaces the earlier decision to leave this list out:
      - Every row action becomes an icon: Edit (pencil), Reset password (key), Disable (circle with a line), Enable (circle
        with a tick), Unlock (open padlock). Same look as the other lists, using `LineIcon` and `iconBtn`.
      - Hovering shows the action's name. The screen reader labels stay as they are ("Reset password for Prabhat Thakur").
      - The actions stay on one line, and the same ones show as today. Reset password, Disable and Enable still open their
        confirmation dialogs.
      - The hidden "Actions" heading becomes visible and right-aligned, like the other lists.

Rejected: changing only Pages. Guides and Process areas have the identical button, so the lists would stop matching.
Rejected: a pencil plus the word "Edit". The request is an icon instead of the text.

## Verification
- `pnpm typecheck`, `pnpm build:admin`, `pnpm test`.
- Check the three lists in a browser, if one is available here. Otherwise Prabhat checks them.

## Out of scope
- Clicking a row still opens the editor, as it does today.

## Rollback
`git restore` the three files, or `git revert` if committed.

## Security Gate
Status: PASSED
- ✅ No secrets in the changed lines. No injection risk (React escapes the title in the label). No security control touched.

## Code Review
Status: APPROVED
- ✅ One shared `EditLink`, so all three lists match; each link has its own label; unused imports removed.
- ✅ Typecheck and admin build clean; 312 tests pass (shared 107, cms 205). No test covers this layout.
- 🟡 Not checked in a browser by me. Prabhat to confirm the three lists.
- ✅ Step 5: same security and review checks on `AuditLog.tsx` and `ui.tsx` (shared `LineIcon`, `iconBtn`). No logic changed.
  Clear has no border, matching the other icons.
- ✅ Step 6: same security and review checks on `UsersList.tsx` (`RowAction`). Same actions, conditions and confirmation dialogs;
  no logic changed. Typecheck and admin build clean; 312 tests pass.