# CMS: Contact inbox and the contact form endpoint

- Flow: FEATURE
- Status: done (approved 2026-11-12, Prabhat: "yes"), not committed
- Requested: 2026-11-12, Prabhat ("implement this page design with contact form with proper design ui", screenshots of the
  "coming soon" Contact inbox and the contact form on contact.html)
- Branch: feature/cms

## Done =
A message sent from the website contact form is stored by the CMS and appears in a working Contact inbox at `/<ADMIN_PATH>/inbox`.

## What exists today (checked 2026-11-12)
- Database: `contact_messages` (id, name, email, company, topic, message, page, status default `new`, ip_hash, created_at),
  index on (status, created_at). Created on Day 1, never written to.
- Dashboard: counts `status = 'new'` and links to `/inbox` (`api/dashboard/routes.ts`).
- Admin: `/inbox` is a "coming soon" placeholder (`SOON` in `admin/src/main.tsx`). Sidebar item exists.
- API: no contact route. `app.ts` refuses any POST whose Origin isn't the API's own host, and limits bodies to 64 KB.
- Site: `contact.html` posts with `fetch` to `https://formspree.io/f/YOUR_FORM_ID` (a placeholder, so messages go nowhere today).
  Fields: `name` (required), `company`, `email` (required), `topic` (4 fixed options), `message` (required), `_gotcha` (honeypot).
  It expects a 2xx response, then shows "Thank you…".
- Hosting: one domain is planned (site plus `/la-studio/api`). Until go-live the live site is FTP-deployed from `main`, and the API has no
  Vercel Function yet. The admin path is chosen not to be guessable, so a public form posting to `/la-studio/api/...` would reveal it.
- Privacy policy (section on cookies and the contact form): "Form submissions are delivered to us through a third-party form-handling
  service" and "We keep your message only as long as needed to handle your enquiry."

- Also found: the local site preview (`api/preview-server.ts`, port 4000) is read-only and answers every POST with 405.
- Roles: `requireUser`, `requireSuperAdmin`; `audit()`; `clientIp(c, trustProxy)` (only trusts `x-real-ip` on Vercel or with TRUST_PROXY).

## Brainstorm
Answers (2026-11-12, Prabhat: "1 (b) 2 (a) 3 we will decide domain mail service at later stage 4 (A) 5 (a) 6 (a)"):
1. **(b)** The form posts to `/<ADMIN_PATH>/api/contact` (same domain). Accepted trade-off: the admin path is visible in contact.html's source.
2. **(a)** The site build (Publish) points the form at the CMS. The repo's `contact.html` and the live FTP site stay as they are.
3. No email for now. The mail service is decided later, so the code keeps one place where a notification can be added.
4. **(a)** Statuses New → Read → Replied → Archived; filters by status and topic; search; "Reply by email"; Delete for Super Admins only.
5. **(a)** Honeypot, 5 messages per hour per visitor, length limits, and forms sent under 3 seconds after the page opened are dropped. No CAPTCHA.
6. **(a)** Update the Privacy policy paragraph, and delete handled messages automatically after 12 months.

## Plan
- [x] 1. **Database** (migration `0007`, generated with `pnpm db:generate`):
      - `contact_messages` gets `status_changed_at` (timestamp, default now) and `status_changed_by` (user, set to null if the user is removed).
      - No other change: the table, its fields and its index exist already.

- [x] 2. **Public endpoint** `POST /<ADMIN_PATH>/api/contact` (new `cms/api/contact/routes.ts`, tests first):
      - No sign-in. Accepts the form as sent today (`FormData`), and JSON. The existing 64 KB body limit and same-origin check apply.
      - Checks: name 1–200, email valid and up to 254, company up to 200, message 1–5,000 characters, no hidden or control characters.
        `topic` must be one of the form's 4 options, otherwise "Something else". `page` is fixed to `contact.html`.
      - Spam: a filled `_gotcha` honeypot, or `_started` missing or under 3 seconds old, gets the same "OK" answer as a real message,
        but nothing is stored (so bots learn nothing).
      - Limits, counted in the database so they also work on Vercel: 5 per hour per visitor, and 100 per hour in total. Visitors are told
        "Too many messages, try again later" (429).
      - The visitor's IP is stored only as a keyed hash (HMAC-SHA256 with the server secret) in `ip_hash`, never as the address itself.
      - Answers `{ ok: true }` (200), so the page's existing script shows its "Thank you" message. Errors use the shapes it already handles.
      - Where an email notification will go later: one marked function, called after a message is stored. It does nothing for now.

- [x] 3. **Inbox API** `/<ADMIN_PATH>/api/messages` (signed-in users; tests first):
      - `GET /`: 30 per page, newest first. Filters: status (`new`, `read`, `replied`, `archived`, `all`, where "all" leaves out archived),
        topic, search (name, email, company, message). Also returns the count per status for the tabs.
      - `GET /:id`: one message. Opening a **New** message marks it **Read**.
      - `PATCH /:id` `{ status }`: sets the status, `status_changed_at` and `_by`.
      - `DELETE /:id`: **Super Admins only**. Writes `message_deleted` to the audit log (id only, no name, email or text).
      - **12-month clean-up:** Replied and Archived messages whose status last changed over 12 months ago are deleted when the inbox is
        opened, at most once an hour. Logged as `messages_purged` with the count only.
      - Audit log screen: the new actions go under a "Messages" filter.

- [x] 4. **Site build** (`packages/shared/src/publish.ts` + `cms/publish/build-site.ts`; tests first):
      - New `applyContactForm(html, adminPath)`: on `contact.html` only, sets the form's `action` to `/<ADMIN_PATH>/api/contact`, adds a
        hidden `_started` field, and adds a one-line script that fills it when the page loads. Nothing else on the page changes.
      - If the form isn't in the expected form, the build warns and leaves the page as it is (like the listing pages).
      - The live FTP site is unchanged until Publish goes live (answer 2).

- [x] 5. **Local preview** (`api/preview-server.ts`): passes `POST /<ADMIN_PATH>/api/contact` to the API in the same process, so the form
      can be tried at `localhost:4000/contact.html`. Every other POST is still refused. Its CSP already allows only same-origin sends.

- [x] 6. **Inbox screen** (`cms/admin/src/screens/ContactInbox.tsx`, replacing the "coming soon" page; same look as the other screens):
      - **Top:** title, a short line about where messages come from, and status tabs with counts: New, Read, Replied, Archived, All.
      - **Toolbar:** search box and topic filter.
      - **List (left on wide screens):** a row per message with name, company, topic chip, the start of the message, and time received.
        New messages are bold, with a dot. Pages of 30.
      - **Message (right on wide screens, full width on phones):** name, email (with Copy), company, topic, received date and time, the full
        message (plain text, line breaks kept), and "Marked replied by Prabhat, 12 Nov" when someone changed the status.
      - **Actions:** **Reply by email** (opens the email app with the address and "Re: your LiveAccess enquiry"), **Mark as replied**,
        **Archive** / **Move back to inbox**, **Mark as unread**, **Delete** (Super Admins, with a confirm).
      - Empty states: "No messages yet. Messages sent from the contact form on the website appear here." and one for an empty search.
      - The Dashboard tile already links here and counts New messages.

- [x] 7. **Privacy policy text** (answer 6). The page lives in the CMS database, so the change belongs in the CMS Privacy draft and goes live
      with the same Publish that switches the form. Proposed wording for the "Contact form" item:
      > **Contact form** — If you send us a message through the website, we use the details you provide (such as your name, email address
      > and message) only to reply to you. Your message is stored in the LiveAccess website's own system, where only authorised TPS staff
      > can read it. We delete it 12 months after we have finished handling your enquiry.

      I make this edit through the admin on your dev server only if you say so. Otherwise you paste it in Pages → Privacy policy.

- [x] 8. **Check in a real browser** on a throwaway API on the **test** database, as last time: send a message from the built site's
      contact page, see it arrive, open it (New → Read), reply, archive, search, filter, delete as a Super Admin, and confirm an
      Editor has no Delete. Also check: honeypot, too fast, the limit, and phone width.
- [x] 9. **Docs:** wiki `cms.md` (endpoint, limits, statuses, clean-up, where the email hook goes).
- [x] 10. Security gate (independent `security-auditor`: this is the CMS's first public, unauthenticated endpoint), `pnpm audit`, post-task review.

## Changes from the plan
- Step 7: Prabhat didn't say whether I should edit his dev database, so I didn't. The wording above is for him to paste.
- Step 2: `_started` is read as a number from JSON as well as text from the form. The first version dropped real JSON messages as spam (caught by a test).
- Step 2: messages store their time from the app's clock, the same clock the limit window uses. The database's own clock made the limit
  miss messages in tests.
- Step 6: the reply `mailto:` link encodes the address. `?` and `&` are legal in addresses, so `x?bcc=…@…` could otherwise add a hidden BCC.
- Step 6: the tab bar hides its scrollbar and scrolls the chosen tab into view. The browser check found a stray scrollbar on desktop and a
  cut-off tab on phones.
- The unused "coming soon" placeholder (`ComingSoon.tsx`) was removed: the inbox was the last section using it.
- Browser check: run on a throwaway API on the **test** database, with the site built into the scratchpad and served by its own preview
  server (the contact form forwarded as on the shared domain). Prabhat's dev data and `.site-preview/` were untouched.

- Security review fixes (step 10): a database lock around count and insert, migration **0008** (index `contact_ip_time_idx`), the
  `_elapsed` field (time on the page) in place of `_started` (a timestamp), IPv6 counted by /64, one shared bucket for an unknown address,
  the preview passes its connection on, and `/contact` needs an `Origin` or `Sec-Fetch-Site: same-origin` header.

## Security Gate
Status: PASSED after fixes (independent security-auditor ran every finding against the test database; each fix has a test, plus a re-run
browser check)
- ✅ Fixed (High): parallel requests beat the limit (30 sent, 30 stored, limit 5). Now count and insert run in one transaction under
  `pg_advisory_xact_lock`. Test: 30 parallel sends store exactly 5, and 25 get 429.
- ✅ Fixed (Medium): a visitor's wrong clock silently dropped real messages, because `_started` was their own timestamp. Now `_elapsed` uses
  `performance.now()` at submit. Browser: 4,252 ms filled in before the page's own script sent the form.
- ✅ Fixed (Medium): many IPv6 addresses from one connection could fill the limits. IPv6 is now counted by /64. Test: the 6th from one /64 gets 429.
- ✅ Fixed (Medium): with no address known, the per-visitor limit was skipped. Unknown addresses now share one bucket, and the preview
  passes its connection on. Test: the 6th gets 429.
- ✅ Fixed (Low): an old browser on another site could post without Origin. `/contact` now needs Origin or `Sec-Fetch-Site: same-origin`. Test.
- ✅ Logged (Low): rules for future email notifications are in `notifyNewMessage`'s comment and the wiki.
- ✅ Sound (auditor): search escaping, body parsing (file parts, repeated fields, `__proto__`, NUL), no PII in logs or the audit log, React
  text only in the admin, the mailto encoding, the role split, no IDOR, the preview forwards one exact path, and the build injection.
- ✅ `pnpm audit`: 1 moderate, no high or critical (unchanged). No new dependencies. No secrets in the diff.
- 🟡 WARNING (before go-live): the 100-per-hour total can still be filled by someone using many networks, which blocks real visitors for
  the hour. Consider an edge or WAF limit, or a challenge (for example Turnstile) once the limit is reached.
- 🟡 WARNING (Prabhat to decide): New and Read messages are never deleted automatically, only Replied and Archived ones after 12 months.
  The Privacy policy says "only as long as needed". Option: also delete any message 24 months after it arrived.

## Code Review
Status: APPROVED
- ✅ Everything in answers 1b, 2a, 3, 4a, 5a and 6a is built. Messages go from the built site into the inbox, with every inbox action.
- ✅ Tests: 485 pass (shared 176, cms 309), including 32 contact and inbox tests. Typecheck and admin build are clean. 27/27 browser checks
  (Super Admin and Editor, phone width, no page errors).
- ✅ The live site is unchanged: the repo's contact.html is untouched, and only the build rewrites the form. Every other page still rebuilds byte-for-byte.
- ✅ No dead code: the unused `ComingSoon` placeholder is removed. No PII is logged.
- 🟡 SUGGESTION: the 12-month clean-up runs on `GET /messages` (a read with a side effect), at most hourly per server. Move it to a
  scheduled job when one exists.
- 🟡 SUGGESTION: no sidebar badge for new messages (out of scope). The Dashboard tile shows the count.

## Verification (2026-11-12)
- `pnpm test`: shared 176 passed, cms 309 passed. `pnpm typecheck`: clean. `pnpm build:admin`: built. `pnpm audit`: no high or critical.
- Browser (headless Chrome; throwaway API and site on the test database): sent from the built contact page; a too-fast send is dropped and
  logged; the page's own email check works; the message arrives (New 2); opening marks it read; reply link; replied; archived; HTML stays text;
  a crafted address can't add a BCC; search and its empty state; topic filter; Super Admin delete; Editor has no Delete; phone layout.
- **Prabhat to do:** run `pnpm db:migrate` on the dev database (migrations 0007 and 0008), and paste the Privacy policy wording from step 7
  into Pages → Privacy policy before the Publish that switches the form.

## Follow-up: "Something went wrong" on the dev server (2026-11-12, Prabhat, screenshot of /inbox)
- **Root cause:** Prabhat's dev database had 7 of 9 migrations. `contact_messages` had no `status_changed_at`/`_by`, so every inbox query
  failed and the API answered with its generic 500.
- **Fix:** `pnpm db:migrate` on the dev database, at Prabhat's request ("let fix that error"). It applied 0007 and 0008, which add columns and an
  index; no data was changed. Checked afterwards: 9 migrations, both columns and the index present, the inbox's list and count queries run, and the
  dev API answers `/messages` with 401 (route loaded, sign-in needed).
- Also: a failed load no longer shows "Loading…" under the error.
- Prevention: the wiki's "Run locally" says to run `pnpm db:migrate` after pulling a change that adds a migration.

## Rejected
- A separate `/api/contact` address: Prabhat chose 1b. The admin path shows in contact.html's source; sign-in, lockout and the
  limits still protect it.
- In-memory rate limits (as page saves use): on Vercel each instance has its own memory, so a database count is used.
- Storing the visitor's IP: a keyed hash is enough to count messages per visitor.
- Rejecting spam with an error: bots would learn to change; they get the same "OK" and nothing is stored.
- A cron job for the 12-month clean-up: there's no scheduler yet. The clean-up runs when the inbox opens, at most once an hour.

## Out of scope
- Email notifications (later, with the domain mail service), replying from inside the CMS, a sidebar badge, assigning messages to people,
  and exporting messages.

## Risks
- **First public endpoint** in the CMS: spam and abuse. Covered by the honeypot, the timing check, length and topic checks, database limits,
  the body limit and an independent security review.
- **Personal data:** messages hold names and emails. They're visible to signed-in users only and kept out of logs and the audit log.
  Handled messages are deleted after 12 months, and the policy text says so.
- **Admin path:** now visible in the contact page's source (accepted in answer 1b).
- **The form stays broken on the live FTP site** (`YOUR_FORM_ID`) until Publish goes live. This work doesn't change that, by choice (2a).

## Rollback
`git revert` the commit. The migration only adds two columns, so the old code still runs on the new schema. Stored messages stay in the table.
