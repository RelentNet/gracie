# Import Outlook / Office 365 contacts into Gracie Contacts

Admin-triggered import that pulls a mailbox's Outlook contacts via the existing
app-only MS Graph daemon and upserts them into Gracie's Contacts — deduped,
idempotent, and safe to re-run.

## ⚠️ Azure prerequisite (read first)

The daemon app currently holds only **`Calendars.Read`** (for the calendar scan).
Reading contacts needs the **`Contacts.Read` APPLICATION permission + admin
consent** added to the same Entra app. Until an Azure admin grants it, every
mailbox read returns **403** and the import reports, in plain language:

> "Microsoft hasn't granted contact access yet — an Azure admin must add the
> Contacts.Read permission to the app."

Nothing fails silently. Mailbox scope is still enforced by the existing Exchange
**Application Access Policy** (same as the calendar scan) — the app can only read
mailboxes in the calendar access group.

## How it works

1. **Admin control** — Contacts → All contacts → **"Import from Outlook"**
   (admin-only button, next to "New contact"). Pick a connected mailbox (default =
   first connected mailbox, e.g. Joe's) or type one, then Import.
   `POST /api/contacts/import { mailbox }` enqueues the job and the modal polls
   `GET /api/contacts/import?jobId=` for a plain-language result:
   *"Imported N new contacts, updated M, skipped K."*
2. **Worker job** (`import-outlook-contacts`, ad-hoc queue) — pages
   `GET /users/{mailbox}/contacts` via the reused app-only Graph client
   (`listMailboxContacts`), then for each contact best-effort upserts (one bad
   record never fails the batch; a re-run is idempotent).

## Field mapping (Graph → Gracie)

| Graph | Gracie |
|-------|--------|
| `displayName` | `contacts.full_name` (falls back to the email when blank) |
| `emailAddresses[0].address` | `contacts.email` (**the dedupe key**) |
| `mobilePhone` ?? `businessPhones[0]` | `contacts.phone` |
| `jobTitle` | `contacts.title` (+ the matched-org affiliation's title) |
| `companyName` | `contacts.company` (plain label) |

## Dedupe rule

- **Keyed by lower-cased email.** A contact with **no email is skipped** (we do
  not fuzzy-match on name+company — too error-prone for an unattended import).
- An existing contact with the same email is **updated to fill only its empty
  fields** — never overwriting a value a human may have edited. When nothing is
  missing the import is a **no-op** (idempotent re-runs).
- New emails within the same batch also dedupe (in-memory map updated on insert).

## Source tagging

Every imported/updated contact is stamped `contacts.source = outlook:<mailbox>`
(filled only when previously empty) so an operator can later identify and
bulk-manage exactly what a given import touched.

## Org affiliation (light)

If the contact's **email domain** (via `client_domains`) **or** `companyName`
(exact, case-insensitive, vs existing org names) matches an **existing** org, a
current `contact_affiliations` row is added (add-only, idempotent — skipped if one
already exists). Otherwise the company stays a plain label on the contact.
**Orgs are never auto-created** — that would spawn hundreds of junk orgs.

## Migration (needs applying)

`packages/db/migrations/0021_contacts_outlook_import.sql` — additive + idempotent,
adds `contacts.source`, `contacts.company`, `contacts.title` (all nullable, no
backfill, no index). Hand-regenerated `packages/db/src/database.types.ts` to match.
**Apply to the shared dev+prod Supabase in coordination with the orchestrator**,
then redeploy **web + worker**.

## Tests / verification

- Unit tests (`apps/worker/src/lib/outlook-contacts.test.ts`, Node test runner):
  the pure Graph→Gracie mapping (phone fallback, no-email skip, blank→null) and
  the dedupe decision (insert / fill-only / skip / never-overwrite).
- `pnpm -r typecheck` + `pnpm -r lint` + worker tests all green.
- **E2E gap:** the live Graph call can't be exercised until `Contacts.Read` is
  granted. The 403 path is handled gracefully (returned, not thrown → no wasted
  retries → clear admin message). A 404 (mailbox not found / not accessible) and a
  generic read failure each get their own plain-language message too.

## Non-technical-operable

One obvious button, safe defaults (dedupe never clobbers edits, re-run safe), no
console/SQL, and every stuck state (permission not granted, mailbox unreadable)
surfaces in-app in plain language with a clear next step.
