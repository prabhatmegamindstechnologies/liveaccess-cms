# CMS: collapsed sidebar, logo and expand button

- Flow: SMALL_TASK
- Status: done
- Requested: 2026-11-04, Prabhat ("on collapse sidebar we need to show expand and collapse icon above the dashboard while tps", with 2 screenshots)
- Branch: feature/cms

## Done =
On the collapsed sidebar the whole TPS logo shows in the top bar area, and the expand/collapse button sits on its own row
directly above Dashboard, with nothing overlapping. The expanded sidebar looks the same as today.

## Brainstorm
N/A (SMALL_TASK, no brainstorm)

## Cause
`cms/admin/src/components/Shell.tsx:69` keeps the sidebar header at a fixed 61px and, when collapsed, stacks the logo and the
32px button inside it. There isn't room for both, so the logo is squeezed to 44px wide and crowded against the button.

## Assumption
The request stops at "while tps". I've read it as "while the TPS logo stays at the top". The screenshots circle the button
and point it down towards the menu.

## Plan
- [x] 1. `Shell.tsx`, collapsed only: the 61px header holds just the logo, centred and as wide as the rail allows (56px).
- [x] 2. `Shell.tsx`, collapsed only: the button moves to its own row below the header line, centred above Dashboard. It stays
      outside the scrolling menu, so it's always reachable on short screens.
- [x] 3. Expanded sidebar unchanged: logo left, button right, in the header. The button keeps its label, title and `aria-expanded`.
- [x] 4. Security gate (3-point) and post-task review.

- [x] 5. Follow-up (Prabhat, 2026-11-04: "remove border from the icon"): take the border off the expand/collapse button, in both
      sidebar states. Keep the light grey background on hover, so it still reads as a button.

Rejected: making the collapsed header taller. Its bottom line would stop lining up with the 61px top bar.
Rejected: hiding the logo when collapsed. The logo needs to stay visible.

## Verification
- `pnpm typecheck`, `pnpm build:admin`, `pnpm test`.
- Check both sidebar states in a browser, if one is available here. Otherwise Prabhat checks them after a refresh.

## Out of scope
- The mobile layout (the sidebar is hidden below the `lg` width).

## Rollback
One file: `git restore cms/admin/src/components/Shell.tsx`, or `git revert` if committed.

## Security Gate
Status: PASSED
- ✅ No secrets in the changed lines. No injection risk (fixed markup only). No security control touched.

## Code Review
Status: APPROVED
- ✅ Logic matches the plan; one shared button, so both states keep the same label and behaviour.
- ✅ Typecheck and admin build clean; 299 tests pass (shared 107, cms 192). No test covers this layout.
- 🟡 Not checked in a browser by me. Prabhat to confirm both sidebar states.
- ✅ Step 5: styling only, security and review re-checked. Typecheck and admin build clean; tests not re-run (no logic changed).
  Hover background went one shade darker (slate-50 to slate-100), matching the menu items, since the border no longer shows it.
