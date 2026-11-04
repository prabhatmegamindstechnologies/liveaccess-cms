# Fix colour-contrast failures (Lighthouse Accessibility 96)

- **Flow:** BUG_FIX
- **Date:** 2026-10-22
- **Branch:** feature/clarity-seo-redesign
- **Status:** Plan — awaiting approval
- **Reported by:** Lighthouse on http://127.0.0.1:5500/ — "Background and foreground colors do not have a sufficient
  contrast ratio" (failing: `span.kicker` ×2, chat bubble `div`, `p` + `div.tile.or` in Key Features).

## Done =
Lighthouse Accessibility shows no contrast failures on the marketing pages, while the bright orange brand look is kept.

## Root cause (measured, WCAG AA needs 4.5:1 for normal text, 3:1 for large text)
Brand orange `#E8541A` is used for **small text** and as a **background behind small light text**:

| Use | Ratio | Result |
|---|---|---|
| Orange label text on white | 3.68 | FAIL |
| Orange label text on grey band `#F7F8FA` | 3.46 | FAIL |
| White text on orange (chat bubble, buttons, step numbers) | 3.68 | FAIL |
| Peach `#FFE4D8` text on orange tile | 3.03 | FAIL |

Large headline text ("One question away.", ≥ 24px bold) is fine at 3.68 (needs 3:1).

## Fix
Use the existing darker shade `--orange-ink` `#C2410C` wherever orange meets small text:

| Use | New ratio |
|---|---|
| `#C2410C` text on white / grey band | 5.18 / 4.87 PASS |
| White text on `#C2410C` | 5.18 PASS |
| Pill (`#C2410C` on `#FFF1EA`) — unchanged | 4.69 PASS |

Changes:
1. `common.css` — `.eyebrow` colour → `var(--orange-ink)`; `.site .btn-primary` background → `var(--orange-ink)`
   (hover a touch darker `#A8380A`).
2. `index.html` — `.kicker` → `var(--orange-ink)`; chat bubbles (`.phone .me`, `.chatlet div:first-child`),
   `.step .n` and `.tile.or` background → `var(--orange-ink)`; `.tile.or p` colour → `#fff` (peach on the new
   shade is 4.28, still failing).
3. `how-it-works.html` — phone bubble `.me`, `.pbtn`, active step number → `var(--orange-ink)`.
4. Keep `#E8541A` for large headlines, icons, dots, glows and borders (non-text, or large text).
5. Bump `common.css` to `?v=2.1.1` on all pages.

## Rejected alternatives
- Dark text on orange — passes, but off-brand.
- Larger label text — changes layout.

## Verification
- Re-run `verify_site.py`.
- Contrast script over the new colour pairs (all ≥ 4.5).
- You re-run Lighthouse → Accessibility; expect 100 or no contrast items.

## Done (2026-10-22)
- Applied changes 1–5 above (11 edits) plus 3 more failures found while checking the rest of the page
  (not visible in the reported screenshot):
  - `index.html` phone `.row` ("AI may be incorrect") `#7A848C` on `#F3F4F5` = 3.46 → `var(--ink-2)` (7+).
  - `index.html` phone input placeholder `#8A939B` on white = 3.12 → `var(--muted)` (4.83).
  - `how-it-works.html` `.disc` → `var(--ink-2)`.
- Large orange text left bright (passes 3:1): hero headline, Plans step numbers (28px), Features "7", About figures.
- `common.css?v=2.1.1` on all 12 pages.

## Verification
- `verify_site.py`: "Checked 12 pages, 11 FAQ entries, 4 HowTo steps, 11 sitemap URLs. All checks passed."
- Contrast script: all changed pairs ≥ 4.5 (orange-ink/white 5.18, white/orange-ink 5.18, orange-ink/#F7F8FA 4.87,
  pill 4.69, muted/white 4.83, ink-2/#F3F4F5 7+).
- Screenshot of homepage at 1366px: design intact.
- Not run here: Lighthouse itself (user to re-run in Chrome DevTools).

## Security gate — PASS (CSS colour values only)
## Post-task review — APPROVED
- Noted, not fixed (out of scope, passes contrast): `.link-arrow` renders dark instead of orange because
  `.site a { color: inherit }` out-specifies it.
