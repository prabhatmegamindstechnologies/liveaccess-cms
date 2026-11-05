# CMS: text editor for guides and process areas

- Flow: FEATURE
- Status: done
- Requested: 2026-11-05, Prabhat ("first we need to plan what kind of edit you will provide", with a screenshot of a guide's Paragraph block)
- Approved: 2026-11-05, Prabhat ("yes")
- Branch: feature/cms

## Done =
The Paragraph box on guides and process areas uses Jodit with only the agreed tools, saves safely, and leaves existing guides unchanged.

## What exists today (checked 2026-11-05)
- `BlockEditor.tsx`: plain text boxes for Paragraph, List item, Safety note and Disclaimer, with no toolbar.
- `packages/shared/src/sanitize.ts` keeps only `b strong em i span small a br time code`. It keeps `class` on `span` and `small`,
  and removes `style`. `u` isn't allowed. Links can be site paths, http(s) or mailto, and can open in a new tab.
- A paragraph holds inline text only. Lists are their own block, with bullet and numbered styles.
- An `image` block type already exists (`blocks.ts`), and needs a Media library item. The Media library isn't built.

## Brainstorm
Prabhat sent a screenshot of a full editor toolbar and asked for those tools on the Paragraph text area. Marked in red: Undo, Redo;
font, size, Bold and its menu, text colour, alignment, lists, image, table, chart, link, emoji, special characters; and an X button.

Consequence: Paragraph blocks can no longer be inline-only. They need their own server-side allow-list, wider than `sanitizeInline`.

Answers (2026-11-05, Prabhat):
- Freedom: **(a)** set choices for fonts, colours and sizes.
- Images: **(a)** add the button after the Media library is built.
- Charts: **(a)** left out.
- The X button: not answered. Assumption: Remove formatting (T×) is included, and the X isn't. Prabhat can correct this.
- Editor: **Jodit** ("No I still want to use jodit"), after seeing my recommendation for TipTap and the comparison.

## Toolbar (left to right)
| Group | Tools |
|---|---|
| History | Undo, Redo |
| Font | Jodit's selector and list, plus Plus Jakarta Sans and IBM Plex Mono first (step 8) |
| Size | Jodit's selector and list, 8 to 96 (step 8) |
| Text | Bold, Italic, Underline, Strikethrough |
| Colour | Two buttons, Font colour and Background colour, each with Jodit's picker: any colour, brand colours first (steps 7, 8) |
| Layout | Align left, centre, right. Bullet and numbered lists |
| Insert | Table, Link, Emoji, Special characters (such as ° ± µ ≤ ≥ × ²) |
| Clean | Remove formatting |

The first two fonts already load on the site, and Arial and Georgia are system fonts, so nothing extra downloads.

## Checked 2026-11-05
- `jodit`: MIT, no extra dependencies. Plugins exist for font, alignment, lists, table, link, special characters and undo. Settings exist
  for `controls.fontsize.list`, `disablePlugins`, `removeButtons`, `hidePoweredByJodit`, `popup.cells`, `specialCharacters`.
- Emoji Picker is paid (PRO), so emoji is our own small toolbar button.
- 7 advisories in GitHub's database: 5 in 2026 (1 high). All are fixed before 4.18.11 or outside its version range. The changelog shows later security fixes too (GHSA-jhhp in 4.17.1), also included. 4.18.12 to 4.19.7 list no security entries.
- All published article HTML comes through `blockHtml` (`articleBody` for lists), so there's one place to change.
- Nothing else reads paragraph HTML. `validateGuide` covers both guides and areas.
- `.cms-table` is written by `blockHtml`, but the wiki says tables still need site CSS.

## Plan
- [x] 0. **Try-out first:** install Jodit at an exact version and confirm in the admin that every agreed tool works, and what it outputs.
      Report anything that can't be done before going on.
- [x] 1. **Safety rules** `sanitizeRich` in `packages/shared/src/sanitize.ts` (tests first), used for Paragraph blocks only:
      - Tags: `p ul ol li table thead tbody tr th td strong em u s a br`, plus `span` for styled text.
      - `style` is kept only when each property and value is on the exact list. Everything else is removed, including `url()`.
      - Links follow the existing safe address rule. Table cells hold inline text only, with no merged cells.
      - Colours are accepted as hex or `rgb()`, because browsers can rewrite them. Jodit's own table widths and styles are removed.
      - The existing nesting limits stay, and the same code runs in the browser and on the server. Security doesn't rely on Jodit's cleaner.
- [x] 2. **Saving and publishing** (tests first):
      - `validateGuide` uses `cleanParagraph` for paragraphs, with a limit of 20,000 characters each. The 100,000 total stays.
      - `blockHtml`: a paragraph that's still plain inline text renders exactly as today. Rich content renders without the extra `<p>`.
      - Test: with no edits, every existing guide and area page rebuilds byte-for-byte the same.
- [x] 3. **Editor** `cms/admin/src/components/RichTextEditor.tsx` with Jodit, in place of the Paragraph text box in `BlockEditor.tsx`,
      so guides and process areas both get it. Toolbar as above, with Jodit's own style. The tags hint is removed.
      - Only the agreed buttons show. Everything else is off, including AI assistant, source view, video, iframe, file and image upload,
        speech, print and the "Powered by Jodit" link. The fonts, sizes and colours are limited to the set lists.
      - A small custom button adds a short emoji list.
      - Opening a guide must not count as an edit, so no false "Unpublished changes".
      - A single plain paragraph is saved as today, without a `<p>` wrapper.
      - Moving a block up or down keeps the right text in the right editor.
      - The editor loads only on these screens, so other admin pages stay fast.
      - Pasted text from Word or the web goes through the same safety rules.
- [x] 4. **Table styling:** add `.cms-table` rules to the existing `common.css`, shown in the live preview and the local site build.
- [x] 5. **Docs:** wiki `cms.md`.
- [x] 6. Security gate (independent `security-auditor`, as this widens what's stored and published), dependency scan and post-task review.

- [x] 7. Follow-up (Prabhat, 2026-11-05: "Need all color selection option here", screenshot of the background dropdown). This replaces
      the set colours from Freedom (a). Fonts and sizes stay as set choices.
      - `RichTextEditor.tsx`: Jodit's own colour popup replaces the two custom dropdowns: one button with Text and Background tabs, a palette,
        a hex box, a full colour picker and a clear button. Brand colours come first in the palette.
      - `sanitize.ts` (tests first): `color` and `background-color` accept any valid `#RRGGBB` or `rgb()` value, always rewritten as `#RRGGBB`.
        Named colours, `url()`, `!important` and anything else are still removed. `RICH_TEXT_COLOURS` and `RICH_BACKGROUNDS` go.
      - Security stays the same: only a strict colour format is accepted, so this can't carry code.
      - Trade-off: authors can now pick off-brand or hard-to-read colours, such as white text on a white page.
      - Verify: tests, typecheck, build and the browser check on Prabhat's running dev server, without starting another server.

- [x] 8. Follow-up (Prabhat, 2026-11-05: "need two seprate option for editor background and font color", "I need here proper size selection
      why u not use the jodit I never want custom editor"). The editor already is Jodit; this removes my limits so it behaves like standard Jodit:
      - **Size:** Jodit's own selector, showing the current size in the toolbar (`component: "select"`), with Jodit's own list:
        8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 32, 34, 36, 48, 60, 72, 96. This replaces the shortened list and the icon-only button.
      - **Font:** the same selector, showing the current font, with Jodit's own list plus the two site fonts first. System fonts, so nothing
        extra downloads. Assumption: "never want custom" covers fonts too.
      - **Colour:** two toolbar buttons, Font colour and Background colour, each opening Jodit's own colour picker directly (`ColorPickerWidget`).
        Jodit's stock button has both on tabs, so showing two buttons needs a small wrapper around Jodit's picker. The hex box fix stays.
      - `sanitize.ts` (tests first): `RICH_SIZES` and `RICH_FONTS` widen to the same lists. Anything off them is still removed.
      - Emoji stays our small button, because Jodit's Emoji Picker is the paid version.
      - Verify: tests, typecheck, builds and the browser check on Prabhat's running dev server, without starting another server.

Rejected: the product in the screenshot (Eddyter). It has paid plans, and sources disagree on its free licence.
Rejected: TipTap, my recommendation. It has far more users, fewer advisories and would match the admin's look, but Prabhat chose
Jodit for its ready toolbar.
Rejected: a new "Rich text" block type. Existing paragraphs would need converting. Keeping `paragraph` needs no data change.
Rejected: CSS classes for every colour and size. It would need many site CSS rules. Exact-value inline styles need none, and the
server still rejects anything off the list.

## Changes from the plan
- `jodit` 4.18.11, not 4.19.6: the project's 7-day install cooldown (`minimumReleaseAge`) blocks newer releases. It has every security fix.
- `jodit` is used directly, without `jodit-react`: recent wrapper versions need a newer Jodit than the cooldown allows, and direct use gives
  better control over not counting an open as an edit.
- This record and `packages/shared/test/rich.test.ts` disappeared from disk mid-task (2026-11-05), cause unknown, and were recreated.
- Jodit's main module loads only core plugins, so the plugins for alignment, cleaning, paste, table cells and symbols are imported by hand.
- Added after the security review: a page policy in `cms/admin/index.html` (`base-uri 'self'; connect-src 'self'`), paste cleaning before insert,
  native drops refused, video link embedding off, stored HTML cleaned on load, and a rewritten `tagDepth`.
- `sanitizeRich` also keeps `b i small time code`, beyond the plan's tag list, so existing inline text isn't lost.

## Security Gate
Status: PASSED after fixes (independent security-auditor, then fixes checked by tests and a real browser; the auditor did not re-review them)
- 🔴 Fixed, B1: a pasted `<base>` could reroute admin API calls. Browser check after the fix: no base tag in the page, `baseURI` unchanged, API works, no policy blocks.
- ✅ Fixed: editor sanitised in the live `document` (now inert); quadratic regex (W1); `tagDepth` bypass (W2); native drops (W3); video iframes (W4);
  stored HTML on load (W5); `012px` and repeated `<br>` (W6); tests widened (W7); record corrected (W8).
- ✅ Published site: 65 hostile payloads produced nothing off the lists. Auth, CSRF and access rules unchanged. `pnpm audit`: 1 moderate, no high or critical.
- 🟡 Logged: plain paragraphs still keep `class`, as all inline text always has. The total limit counts text before escaping. Limits are in memory.
- 🟡 Before go-live: paste was tested with a synthetic event, so confirm once with a real copy and paste. The page policy is in a meta tag; add it as a header when the admin's hosting is set up.

- 🟡 Step 7: not sent back to the independent reviewer. Colours are parsed strictly and rewritten as `#RRGGBB`; `rgb()` values over 255, named colours, `url()` and `!important` are removed. Selection is held for the hex box and picker, checked in a real browser.
- 🟡 Step 8: the wider font and size lists are still exact allow-lists, checked by tests and in a real browser. Not sent back to the independent reviewer.

## Code Review
Status: APPROVED
- ✅ All plan steps done. Existing guides keep their stored value, and opening one saves nothing (version unchanged in the browser).
- ✅ 335 tests pass (shared 130, cms 205); typecheck, admin build and `pnpm build:site` clean.
- ✅ Real browser (Edge), dev server and production build: all 20 tools, table popup, hostile paste, block moves, no page errors.
- 🟡 No automated test covers the editor screen itself. The browser checks were one-off scripts.

## Verification
- `pnpm test`, `pnpm typecheck`, `pnpm build:admin`, `pnpm audit`.
- Hostile input tests: scripts, event attributes, `style` tricks, `javascript:` links, unknown fonts, colours and sizes.
- Local database: open a guide without typing and confirm that nothing saves and no new "Unpublished changes" appears.
- `pnpm build:site`: check a guide using every tool. Check the screen in a browser, if one is available here. Otherwise Prabhat checks it.

## Out of scope
- Images (after the Media library) and charts.
- List items, Safety notes, Disclaimers, headings and all website pages keep their current boxes.

## Risks
- Jodit has had HTML-cleaning flaws that could run in a signed-in admin's browser. Keep it pinned and update it when an advisory appears,
  and use `pnpm audit` before each release.
- Jodit is about 2x the size of the whole admin today, so it must load only on the guide and area editor screens.
- Authors can now change how a guide looks, within the set choices.
- `common.css` is a live site file, so the table rules reach the live site when this branch reaches `main`. They only affect tables.
- A rich paragraph holding several elements wouldn't read back into one block through `pnpm import:site`, which shouldn't be run anyway
  because it overwrites page drafts.

## Rollback
No migration. `git revert` the commit. Any paragraphs saved with rich content would need re-editing, because the old rules strip them.
