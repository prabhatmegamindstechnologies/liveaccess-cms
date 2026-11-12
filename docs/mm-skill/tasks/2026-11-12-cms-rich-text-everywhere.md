# CMS: rich text editor beyond Paragraph blocks

- Flow: FEATURE
- Status: done (approved 2026-11-12, Prabhat: "yes"), not committed
- Requested: 2026-11-12, Prabhat (6 screenshots: FAQ answer, guide summary, area paragraph, area name and intro, guide bullet list)
- Branch: feature/cms

## Done =
Every field Prabhat listed opens in Jodit, saves clean HTML that passes the server checks, and shows the same in the live preview and on the published page.

## Request
- Process area: Name, Intro line, Disclaimer, Safety note
- FAQ page: Main heading, Intro text, About LiveAccess, Questions we get asked, Still have a question?
- Troubleshooting guides: Bullet list with colour, font size and style
- Privacy policy: Paragraph, List item
- Screenshot 3 also marks the guide **Summary**.

## Why Jodit only shows on Paragraph today (checked 2026-11-12)
This was a scope decision, not a bug. The 2026-11-05 editor task says under "Out of scope": *"List items, Safety notes, Disclaimers,
headings and all website pages keep their current boxes."*

## What exists today
There are three separate places to change, each with its own save path:

| Where | Admin component | Saved as | Cleaned by |
|---|---|---|---|
| Guide and area blocks (list, safety note, disclaimer) | `BlockEditor.tsx`, plain `textarea` | JSON blocks | `validateGuide` → `sanitizeInline` (no `style`, no `u`/`s`); `blockHtml` / `articleBody` on publish |
| Area Name and Intro, guide Title and Summary | `AreaEditor.tsx` / `GuideEditor.tsx` inputs | plain text | `text()` in `validateGuide`; escaped into `<title>`, H1, crumbs, JSON-LD, og tags, meta description, "Guides for {name}." band and cards |
| Website pages (FAQ, Privacy, every other page) | `FieldList.tsx`: textarea plus a home-made B / I | full page HTML (layout lock) | `writeField` → `sanitizeInline`; server `checkPageHtml` (`cms/api/pages/guard.ts`) **refuses any style value the published page doesn't already have** |

Consequences:
- Page fields are one element's inner HTML (an `h1`, `p`, `li`, `summary`). Block tools (paragraphs, lists, tables, alignment, images) would break
  the layout lock, so page fields can only take **inline** formatting: font, size, colours, B/I/U/S, links.
- `checkPageHtml` must accept `u`, `s` and `style` values that pass the same exact allow-list as `richStyle`, instead of only styles already on the page.
- Name and Summary feed `<title>`, meta and JSON-LD, which can't hold HTML.
- A page can have 40 or more text fields. 40 Jodit editors at once would be slow, so each field should become an editor only when clicked.

Also seen: screenshot 6 shows the size selector reading **"0px"** on a guide paragraph. That's a display bug to fix along the way.

## Brainstorm
Answers (2026-11-12, Prabhat: "1(a) 2(a) 3(a) 4(a) 5(a)"):
1. **(a)** Area **Name** and guide **Summary** stay plain text boxes. They feed `<title>`, meta, JSON-LD, crumbs and cards.
2. **(a)** Single-line fields get a **text-only toolbar**: Undo, Redo | Font, Size | Bold, Italic, Underline, Strikethrough |
   Font colour, Background colour | Link, Emoji, Special characters | Remove formatting. No alignment, lists, tables or images.
3. **(a)** Bullet and numbered lists keep their block (style, add, remove, reorder). **Each item** gets its own editor with the toolbar above.
4. **(a)** **Every website page** gets the editor on its text fields. Short labels stay as plain boxes: Button text, Link text, Number,
   Label, Small label above heading, Form label, and text that sits beside other elements ("node" fields).
5. **(a)** **Click to edit:** each field shows its formatted text, and turns into Jodit when clicked. One editor is open at a time.

Consequence of 1 and 2 for the area **Intro line**: it's the same stored field as the guide Summary (`summary`), and it also feeds the
meta description fallback, og:description, JSON-LD and the area card. Decision: for **areas only**, `summary` is stored as text-only HTML.
The page intro (`lede`) shows it formatted, and every other place gets its plain text. The guide Summary stays plain, as chosen in 1.

## Toolbar ("text" mode)
| Group | Tools |
|---|---|
| History | Undo, Redo |
| Font | Same font and size selectors and lists as Paragraph (`RICH_FONTS`, `RICH_SIZES`) |
| Text | Bold, Italic, Underline, Strikethrough |
| Colour | Font colour, Background colour (same two buttons and picker as Paragraph) |
| Insert | Link, Emoji, Special characters |
| Clean | Remove formatting |

Enter adds a line break (`<br>`), never a new paragraph, so the field stays inside its one element.

## Plan
- [x] 0. **Try-out first:** in the admin, set Jodit to "text" mode (Enter → `<br>`, no block tools; I'm guessing the option is
      `enter: "BR"`, to be confirmed here) and confirm it outputs only inline HTML. Also find the cause of the **"0px"** size on the
      guide paragraph (screenshot 6). Report anything that can't be done before going on.

- [x] 1. **Safety rules** in `packages/shared/src/sanitize.ts` (tests first):
      - New `sanitizeText(html, doc)`: the `sanitizeInline` tags plus `u` and `s`, with `style` kept only through the existing
        `richStyle` allow-list (colour, background, font, size; **no** `text-align`). `class` is kept exactly where `sanitizeInline` keeps it.
      - Key rule: for text with no style, `u` or `s`, `sanitizeText` gives **exactly** the same output as `sanitizeInline`, so
        nothing already stored or published changes.
      - Hostile input tests: the same set as `rich.test.ts` (event attributes, `url()`, `expression`, `!important`, unlisted fonts or
        sizes, `javascript:` links, deep nesting), plus block tags (`p`, `ul`, `table`, `img`, `div`), which lose their tags and keep their text.

- [x] 2. **Guides and process areas, saving and publishing** (`guides.ts`, `blocks.ts`, `areas.ts`, `publish.ts`; tests first):
      - List items, Safety note text and Disclaimer text use `sanitizeText` in `validateGuide`, `blockHtml` and `articleBody`.
        The Safety note **title** stays plain.
      - Area `summary` (Intro line): `validateGuide` with `kind: "area"` cleans it with `sanitizeText`, with a limit of 300 characters of
        **visible** text and 3,000 of HTML. The guide Summary keeps today's plain-text check.
      - `renderAreaPage`: the `lede` gets the cleaned HTML. Meta description, og:description, JSON-LD and the area card on the
        Process areas page get its plain text. `areaFromPage` reads a `lede` that contains tags.
      - The area card is rewritten only when the plain text changes (`summaryChanged` compares plain text).
      - Test: with no edits, all 6 guide pages, all 8 area pages and the Process areas page rebuild **byte-for-byte** the same.

- [x] 3. **Website pages, saving** (`fields.ts`, `cms/api/pages/guard.ts`; tests first):
      - `fields.ts`: new `richField(f)`, true for text fields except the plain labels from answer 4. `textField` reads and `writeField`
        writes those fields with `sanitizeText`; other fields keep `sanitizeInline`.
      - `checkPageHtml`: also allows `u` and `s`, and a `style` value on an inline tag when `richStyle(value) === value`, meaning it's
        already in the exact allow-list form. Styles on the page's own layout elements still can't change. Everything else stays as it is.
      - Tests: opening and saving every page with no edits gives byte-for-byte the same HTML. A coloured, resized FAQ answer saves.
        Hostile styles, `u` or `s` with event attributes, and styles on a `div` or `section` are refused.

- [x] 4. **Editor** (`RichTextEditor.tsx`):
      - A `mode` prop: `"rich"` (Paragraph, unchanged) or `"text"` (toolbar above, Enter → `<br>`, `sanitizeText` on read, load and paste).
      - Image button, alignment, lists and table only in `"rich"`. Paste and drop rules stay as they are in both modes.
      - The ARIA label comes from a prop, not always "Paragraph text".
      - Fix the "0px" size display found in step 0.

- [x] 5. **Click to edit** (new `cms/admin/src/components/RichField.tsx`):
      - When closed, it shows the field's cleaned HTML in a box styled like the current inputs. When clicked or focused with the keyboard,
        it lazily loads `RichTextEditor` in `"text"` mode, with the caret in the field.
      - One editor open at a time: opening another field closes the current one, keeping its value.
      - Opening and closing a field without typing saves nothing (the same rule as Paragraph, so no false "Unpublished changes").
      - Clicking text in the preview still jumps to its field and opens the editor.

- [x] 6. **Use it everywhere it was asked for:**
      - `BlockEditor.tsx`: list items (each with its own `RichField`, keeping the bullet or number, remove and add), Safety note text, Disclaimer text.
        The old "Allowed: <strong>…" hint goes.
      - `AreaEditor.tsx`: Intro line. The Name stays an input.
      - `FieldList.tsx`: rich fields use `RichField`. The home-made B / I buttons and the "Keep the tags" hint go. Plain labels keep their input.
      - `GuideEditor.tsx`: no change (Title and Summary stay plain).

- [x] 7. **Check in a real browser** on Prabhat's running dev server (no second server started):
      - FAQ: Main heading, Intro text, About LiveAccess, a question and an answer, and the "Still have a question?" band, each with colour,
        size, font, underline and a link. Save, reload and check the live preview.
      - Privacy policy: a paragraph and a list item.
      - Area: Intro line, Disclaimer, Safety note. Guide: bullet items. Open each screen without typing and confirm nothing saves.
      - `pnpm build:site`: the formatting shows on the built pages, and meta and JSON-LD show plain text.

- [x] 8. **Docs:** wiki `cms.md` (where each editor mode is used, the `sanitizeText` rule, the guard change).
- [x] 9. Security gate (independent `security-auditor`, because this widens what's stored and what the page guard accepts),
      `pnpm audit`, post-task review.

## Security Gate
Status: PASSED (independent security-auditor ran bypass payloads; its one Low finding was fixed and re-measured)
- ✅ No Critical, High or Medium. Styles are rebuilt only from fixed lists, so `url()`, `expression`, `\75`, comments, `;` and entity tricks
  don't survive. The guard's `richStyle(v, false) === v` can't be met by anything dangerous. `FORBIDDEN_ATTR` still runs first on every
  attribute. Duplicate attributes resolve the same way in linkedom and browsers.
- ✅ Admin display (`RichField`) is cleaned in an inert document, with class, href, target and rel removed. Load and paste go through `sanitizeText`.
- ✅ Area intro: meta and og are escaped plain text, and JSON-LD doesn't use it. Old plain intro lines now render through `sanitizeText`.
- ✅ Fixed (Low): `cleanText`'s trailing-`<br>` regex was quadratic (50,000 `<br>` then text: 11.4 s). Now a loop: 0.2 ms.
- ✅ `pnpm audit`: 1 moderate, no high or critical (unchanged). No new dependencies. No secrets in the diff.
- 🟡 A `javascript:` link typed into Jodit's link dialog is live in that author's own editor until saved. The server strips it on save.

## Code Review
Status: APPROVED
- ✅ Every requested field uses the editor as agreed (answers 1a to 5a). Plain boxes stay plain.
- ✅ Existing content unchanged: `sanitizeText` matches `sanitizeInline` on every element of all 29 pages, and all 6 guides and 8 areas rebuild byte-for-byte.
- ✅ 448 tests pass (shared 173, cms 275). Typecheck and admin build are clean. 32/32 browser checks with no page errors. 10/10 site-build checks.
- 🟡 SUGGESTION: the `TEXT_STYLED` tag list is in both `sanitize.ts` and `guard.ts`; one export would keep them in step.
- 🟡 SUGGESTION: no automated test covers the editor screens. The browser checks are scratchpad scripts, as in the 2026-11-05 task.
- 🟡 SUGGESTION: clicking the "Intro line" label doesn't open the field (clicking the box does).

## Verification (2026-11-12)
- `pnpm test`: shared 173 passed, cms 275 passed. `pnpm typecheck`: clean. `pnpm build:admin`: built.
- Real browser (headless Chrome, built admin, throwaway API on the test database): 32/32. Covered: the toolbar is exactly the agreed 14 tools;
  one editor at a time; opening without typing saves nothing; the caret lands in the editor; the size box shows 16px, not 0px; Enter gives `<br>`;
  a hostile paste is cleaned; a field formatted end to end keeps its place after a reload; bold made just before switching fields is kept.
  Fields covered: FAQ heading, intro, answer and "Still have a question?"; Privacy paragraph and list item; area Intro line, Safety note and
  Disclaimer; guide bullet item. Plain boxes checked: button text, area Name, guide Summary.
- Site build from the test data: formatting on FAQ, Privacy, area and guide pages; area meta, og, JSON-LD and the Process areas card are plain.
- 🟡 Prabhat to check once on his own dev server: a real copy and paste from Word or the web, and the look in the styled live preview (the
  throwaway server didn't serve the site CSS).

## Progress
Done.

## Changes from the plan
- Step 0 confirmed `enter: "br"` (lower case) and `autofocus` in Jodit 4.18.11. The "0px" cause: Jodit's select falls back to its list's first
  key, which is `"0"` for a list of numbers, when the caret is in text with no element of its own. The size control now falls back to the editor's real size.
- Jodit's `autofocus` runs before the text loads, so the caret is placed after loading instead.
- **Found in the browser check (not in the plan):** a field formatted from end to end (`<h1><span style>…</span></h1>`) has no text of its
  own, so after a reload `buildFields` made the inner span the field (label "Text"). New `formattedOnly` rule: the outer element stays the field
  when the inside carries the editor's marks. A survey of all 29 pages showed a broader rule would have changed about 80 existing fields, and
  this one changes none (tested). `u` and `s` were added to the field reader's inline list, or an underlined word would split a paragraph.
- The editor sends its last state when it closes, because Jodit reports a change a moment late and opening another field closes the editor.
- Browser check: run against a throwaway API on the **test** database (port 8797) and the built admin (port 5199), not Prabhat's dev server,
  so no test formatting landed in his drafts. The site build was checked the same way, into the scratchpad, not `.site-preview/`.

## Rejected
- Formatting on area Name and guide Summary: they feed `<title>`, meta and JSON-LD, which can't show formatting (Prabhat chose 1a).
- Block tools (alignment, lists, tables, images) in page fields: they would break the layout lock, since each field is inside one element.
- One Jodit for a whole list block: it would lose the list block's own controls (Prabhat chose 3a).
- A Jodit for every field at all times: 40+ editors on FAQ would make the screen slow (Prabhat chose 5a).
- Widening `sanitizeInline` itself: it's used by every field and import. A separate `sanitizeText` keeps old behaviour exactly where it's not wanted.
- Letting `checkPageHtml` accept any style on new spans: only exact allow-list values pass, so the guard stays an allow-list.

## Out of scope
- Guide and area Heading blocks, the Safety note title, guide Title and Summary, area Name, SEO fields, menus and site settings.
- Formatting inside button text, link text, labels and numbers on website pages.

## Risks
- **Look and feel:** authors can now change the colour and size of headings and FAQ text on every page, so a page can drift off-brand.
- **Page guard:** the server now accepts new inline styles on pages. This is limited to the same exact allow-list as Paragraph, tested
  with hostile input and reviewed independently.
- **Page edits:** the read side of page fields changes (`sanitizeText` instead of `sanitizeInline`). Protected by the byte-for-byte rebuild test on every page.
- **Area intro:** stored HTML now goes into the `lede`. Meta and JSON-LD get plain text only, tested.
- Jodit stays at the pinned 4.18.11. No new dependency.

## Rollback
No migration. `git revert` the commit. Any text saved with the new formatting would lose its styles when next saved under the old rules
(the words stay).
