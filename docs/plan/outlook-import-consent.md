# Consent allow-list for Outlook contact import

**Branch:** `feat/outlook-import-consent` · **No migration** (single `settings` row).

## Why
#121 added an admin-triggered Outlook contacts import (`POST /api/contacts/import { mailbox }`)
that reads ONE mailbox's Graph contacts. The Azure `Contacts.Read` app permission is
**tenant-wide**, so an admin could type *any* mailbox and Gracie would read it. This adds an
app-level opt-in allow-list: Gracie only ever imports mailboxes that have consented.

## What shipped

### 1. Consent store — no migration
Single `settings` row `outlook_contact_import_consent`, value = JSON `string[]` of
**lower-cased** allowed mailbox emails. Empty / missing / unparseable ⇒ **default deny**.
- Pure logic (normalize / dedupe / add / remove / `isConsented` / `applyConsent`):
  `apps/web/lib/contact-import-consent.ts` (no `server-only`, unit-tested).
- Read/write over the existing settings path: `apps/web/lib/data/contact-import-consent.ts`
  (`getConsentList`, `setConsent`) — same upsert pattern as the brand-logo keys.

### 2. Enforcement (the teeth)
`apps/web/app/api/contacts/import/route.ts` — after `isAdmin`, the POST rejects a mailbox not
on the allow-list **before enqueue**, so a non-consented mailbox never reaches the worker or
Graph. Returns `{ enqueued: false, result: { ok:false, reason:'not_consented' } }` inline (no
job created). `not_consented` added to the worker `FailReason` union; the modal shows a plain
message ("This person hasn't allowed contact import…") and stops without polling.

### 3. Admin roster — Settings → **Contacts** (admin-only)
`ContactsSettingsPanel.tsx` + `GET/PATCH /api/settings/contact-import-consent`. Lists every app
user with an on/off toggle (on = email present in the list), plus an "Allow another mailbox"
field for non-app people (e.g. Joe / a shared mailbox) and a Remove control on those extras.
Web-only — no Graph/worker call to enumerate mailboxes.

### 4. Self-serve — new **My Settings** page (any logged-in user)
`apps/web/app/(app)/my-settings/page.tsx`, one card, reusing the shared `SettingToggle`.
Backed by `GET/PATCH /api/me/contact-import-consent`, which **always derives the mailbox from
the session** (`getRequestUser` → `getEmailByLogtoId`) and **ignores any address in the body** —
a user can only opt themselves in/out. Not admin-gated.

## Tests
`apps/web/lib/contact-import-consent.test.ts` (node:test, 7 cases): default-deny, case/trim/
dedupe/normalize, `isConsented` robustness, add-idempotence, remove case-insensitivity,
serialize round-trip, and **self-scoping** (a consent write only ever changes the one mailbox).

## Decisions flagged
- **Settings key:** `outlook_contact_import_consent` (matches the `snake_case` scalar-settings
  convention: `internal_email_domains`, `brand_logo_key`, …).
- **My Settings nav placement:** a `<Link>` in the Sidebar's bottom **account card** (above
  Sign Out), not in the role-gated `NAV_GROUPS`, so every signed-in role can reach it.
- **Removed / renamed user's stale email:** the allow-list stores plain emails, decoupled from
  `users`. A user's toggle is derived by matching their current email against the list, and any
  allowed mailbox not tied to an app user shows under "Other mailboxes" with a Remove control —
  so a departed user's stale entry is visible and one-click removable, never orphaned.
- **Self-serve PATCH field:** accepts `{ allow }` (documented) and `{ enabled }` (what the
  shared `SettingToggle` sends); `mailbox`/`email` in the body is never read.
- **Concurrency:** `setConsent` is read-modify-write, last-write-wins on the single row —
  fine for a rarely-edited firm setting (marked `ponytail:` in the data layer).

## Not done (YAGNI)
- No Graph call to auto-discover calendar-group members — typing a mailbox is enough.
- Local mock auth has no `users` row for the mock id, so the self-serve toggle 404s locally
  (same limitation as the existing per-user timezone setting); works under real Logto.
