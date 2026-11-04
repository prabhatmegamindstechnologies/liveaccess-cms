# CMS: Listing pages out of step with the build

- Flow: BUG_FIX
- Status: done (not committed)
- Requested: 2026-11-04, Prabhat ("I have total 7 item in guides then why not listing in Troubleshooting guides")
- Branch: feature/cms
- Brainstorm: N/A (BUG_FIX — no brainstorm)

## Done =
After Build preview, `guides.html` shows a card for every built guide and `process-areas.html` a card for every built
area, so the Publish centre count and the listing agree (7 and 7 today). With no drafts, both pages stay byte-for-byte
as they are.

## Symptom
Publish centre says Guides 7. `http://localhost:4000/guides.html` shows 6 cards. The guide's own page and its card on
the High shear mixing area page are there.

## Root cause
`guides.html` and `process-areas.html` are stored pages with hand-written cards. `cms/publish/build-site.ts` writes them
from `pages.html` and never adds what it built. This was listed under Out of scope in
`2026-11-04-cms-local-publish.md`, which was the wrong call: the preview contradicts its own count.

Two places in `guides.html` hold the list: the cards in `.feat-grid` and the JSON-LD `ItemList`.

## Plan
- [x] 1. **Failing tests first** (`packages/shared/test/publish.test.ts`, `cms/test/publish.test.ts`):
      new guide appears in cards and ItemList; new area appears on `process-areas.html`; a changed title or summary
      updates its card; a left-out draft has no card; no drafts means byte-for-byte unchanged.
- [x] 2. **Shared** `applyGuideList(html, guides)` and `applyAreaList(html, areas)` in `packages/shared/src/publish.ts`:
      - Keep the page's own card order (hand-made), new items at the end, as on the area pages.
      - A card whose guide or area is unchanged stays byte-for-byte, because some card text is hand-written.
      - A changed or new card uses the title, area name and first sentence of the summary, escaped.
      - Keep `ItemList` in step, including positions and any count on the page.
      - Throws if the markup isn't in the expected form.
- [x] 3. **Build** `cms/publish/build-site.ts`: render both listing pages after guides and areas are known, so the cards
      use only what was built.
- [x] 4. **Publish centre:** show all of a draft's problems, not just the first three.
- [x] 5. **Docs:** wiki `cms.md`, and remove the "no card on listing pages" notes.

Rejected: rebuilding every card from the database. It's simpler, but it would rewrite hand-made card text, and the
preview would then show differences nobody made.

## Verification
- `pnpm test`, `pnpm typecheck`.
- `pnpm build:site` on the local database, then confirm 7 guide cards on `http://localhost:4000/guides.html`.
- Confirm `git status` shows no root site file changed.
- Mandatory `security-gate` and `post-task-review`.

## Out of scope
- "Mark as published" (not requested). The guide stays Draft until real Publish exists.
- The page HTML guard fix (still required before real Publish).

## Rollback
Remove the two functions and their calls in `build-site.ts`. No database change. Nothing is committed unless asked.

## Changes from the plan
- One function, `applyListing(html, kind, items)`, instead of two: the pages differ only in their prefix and label.

## Security Gate
Status: PASSED
- ✅ Not a security bug: a missing card only.
- ✅ New output is escaped: card text as HTML, names in the JSON-LD with < escaped (tested with </script>). Slugs are validated.
- ✅ No auth, session or permission code touched; no new attack surface; no control weakened.
- ✅ Same pattern checked: both listing pages fixed. Home and Features link no guides or areas.

## Code Review
Status: APPROVED
- ✅ Root cause fixed in the build, not patched in the page. Regression tests failed first, then passed.
- ✅ Edge cases: left-out drafts, removed cards, hand-written text, missing markup (throws; the build then warns).
- 🟡 SUGGESTION: a card removed by hand in the page editor comes back while its guide exists.

## Verification (2026-11-04)
- `pnpm test`: shared 107 passed, cms 131 passed. `pnpm typecheck` clean.
- Local database: 7 guides built, 7 cards and 7 ItemList entries on guides.html, 8 cards on process-areas.html.
- guides.html differs from the source only by the new guide and the draft menu label. No root site file changed.
