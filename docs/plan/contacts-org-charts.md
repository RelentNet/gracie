# Delegation Brief — Contacts & Org Charts (`CO` — standalone pre-launch phase)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. **Greenfield feature** (no contacts/office/affiliation tables exist today) — a new top-level **Contacts** area plus a per-org **org chart**. **Pre-launch phase** (before P10).
> **Branch + PR for review. Do NOT push to `main`.**

---

## 0. Read first (cold-start context)

- `docs/HANDOFF.md` / `docs/09-build-phases.md` — product state (live in prod; P1–P6, P6B(+.1/.2), P4/P4.1 calendar, P2.1 client editing, in-app role mgmt all shipped).
- `docs/04-database-schema.sql` + `packages/db/src/database.types.ts` — schema + generated types. **No contacts/people/office/position/affiliation/suggestion table exists** — this is all new.
- **"Org" = a `clients` row of ANY `type`** (client / prospect / lead / partner / internal — from P4.1). Contacts link to orgs via that table. Domain→org matching lives in `client_domains` + `apps/worker/src/lib/calendar-match.ts` (`resolveMeetingOrgs`).
- `docs/08-design-system.md` — component conventions, tabs, states.

### Where to touch (mapped by the orchestrator — trust, then verify)
| Concern | File(s) |
|---|---|
| Add `/contacts` nav item | `apps/web/lib/navigation.ts` (`NAV_ITEMS`) — data-driven; `Sidebar.tsx` needs no change |
| New top-level page | `apps/web/app/(app)/contacts/page.tsx` (+ `layout.tsx` if it needs sub-sections) |
| Per-org Contacts sub-tab (fast-follow) | `apps/web/app/(app)/clients/[clientId]/layout.tsx` (`CLIENT_TABS`) + `.../contacts/page.tsx` |
| Permissions | `packages/shared/src/constants/permissions.ts` (`PERMISSIONS` + `PERMISSION_MATRIX`) |
| Server data layer | new `apps/web/lib/data/contacts.ts` (model on `apps/web/lib/data/clients.ts`) + mapper in `apps/web/lib/mappers/` |
| API routes | new `apps/web/app/api/contacts/**` + `apps/web/app/api/clients/[clientId]/{offices,org-chart}/**` (model on `apps/web/app/api/clients/[clientId]/domains/route.ts`) |
| Suggestions source | `meetings.external_attendees` jsonb + `client_domains`; reuse `parseStoredExternalAttendees` + the domain→org map from `apps/worker/src/lib/calendar-match.ts` |
| Migration | new `packages/db/migrations/0008_contacts_org_charts.sql` (idempotent style of `0004`/`0007`), then `supabase gen types` → `packages/db/src/database.types.ts` |
| Hand types | new `packages/shared/src/types/contact.ts` + export via `packages/shared/src/types/index.ts` |
| CSV export | none exists — build a helper/route |

---

## 1. The vision (operator) + LOCKED decisions

A consultancy needs to know **who holds which office** at every client and partner (VA, etc.) and **how to reach them**. Build a Contacts capability where:

1. **Offices are first-class** — an office/position belongs to an org, has a **reports-to parent** (the org chart), and **can be VACANT** (no contact) so "we're missing the VA CIO" is a real, trackable, flaggable state.
2. **Contacts are people**; they **fill offices** via **affiliations**.
3. **Multi-org + history** — a contact can be affiliated with **multiple orgs**, and each affiliation has a **tenure** (start/end) so when someone moves VA → a client you see the **full history** and who **currently** holds each office.
4. **Full visual org chart out the gate** — per org, a tree of offices (each node shows the current contact or "Vacant · add contact"), plus a flat, searchable contact list.
5. **Suggestions from meeting attendees** (the P4.1 `external_attendees` the calendar already captures) — surfaced **in the Contacts area, NOT the calendar UI** (it's already crowded). Build it as a **general suggestions queue** so the future **n8n "scan the web for vacant offices → recommend contacts"** automation feeds the **same** inbox (design the hook; don't build n8n).
6. **Per-contact CSV export** — a button on the contact profile that downloads their info (works on mobile). Also a per-org export.
7. **v1 = the top-level Contacts tab**; the per-org Contacts sub-tab on the client detail page is a **cheap fast-follow** once components exist (include if quick).

---

## 2. Data model — migration `0008_contacts_org_charts.sql`

Idempotent style of `0004`/`0007` (`create table if not exists`, guarded, additive). After applying, regenerate types (`supabase gen types` → `packages/db/src/database.types.ts`) and add hand types in `packages/shared/src/types/contact.ts`.

```sql
-- 0008_contacts_org_charts.sql — Contacts & Org Charts. Additive + idempotent.

-- 1. Contacts = people (org-agnostic; linked via affiliations).
create table if not exists contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  email              text,
  phone              text,
  linkedin_url       text,
  notes              text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_contacts_name  on contacts (lower(full_name));
create index if not exists idx_contacts_email on contacts (lower(email));

-- 2. Offices / positions per org = the org-chart NODES. Can be VACANT.
create table if not exists offices (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,   -- the org
  title            text not null,
  parent_office_id uuid references offices(id) on delete set null,           -- reports-to (hierarchy)
  description      text,
  is_key           boolean not null default false,                           -- flag important offices to watch (esp. when vacant)
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_offices_client on offices (client_id);
create index if not exists idx_offices_parent on offices (parent_office_id);

-- 3. Affiliations = contact ↔ org (+ optional office) WITH history + multi-org.
create table if not exists contact_affiliations (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,        -- the org
  office_id   uuid references offices(id) on delete set null,                -- optional formal office
  title       text,                                                          -- freeform title when no office
  org_email   text,                                                          -- org-specific contact info (optional)
  org_phone   text,
  started_on  date,
  ended_on    date,                                                          -- null = ongoing
  is_current  boolean not null default true,                                 -- app-maintained (see invariants)
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_affil_contact on contact_affiliations (contact_id);
create index if not exists idx_affil_client  on contact_affiliations (client_id);
create index if not exists idx_affil_office  on contact_affiliations (office_id) where office_id is not null;
create index if not exists idx_affil_current on contact_affiliations (is_current) where is_current;
-- At most ONE current holder per office:
create unique index if not exists uq_office_current_holder
  on contact_affiliations (office_id) where office_id is not null and is_current;

-- 4. Suggestions queue (source-agnostic: calendar attendees now, n8n web-scan later).
create table if not exists contact_suggestions (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,                        -- 'calendar_attendee' | 'n8n_web' | ...
  suggested_name   text,
  suggested_email  text,
  suggested_domain text,
  client_id        uuid references clients(id) on delete set null,   -- guessed org (by domain)
  office_id        uuid references offices(id) on delete set null,   -- if suggesting a fill for a vacant office
  meeting_id       uuid references meetings(id) on delete set null,  -- provenance (calendar source)
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'pending',      -- 'pending' | 'accepted' | 'dismissed'
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);
create unique index if not exists uq_suggestion_dedup
  on contact_suggestions (source, lower(suggested_email))
  where suggested_email is not null and status = 'pending';
create index if not exists idx_suggestions_status on contact_suggestions (status);
```

**Model rules / invariants:**
- **Vacant office** = an `offices` row with no `contact_affiliations` where `office_id = it AND is_current`. The `uq_office_current_holder` index guarantees at most one current holder.
- **Fill an office / move a person:** setting a new current holder for an office must first **end the prior current affiliation** for that office (`ended_on = today`, `is_current = false`) — do this in the data layer, not the DB, so history is preserved.
- **Contact leaves an org:** end that affiliation (`ended_on`, `is_current=false`); the row stays as history.
- **Multi-org:** a contact may have several `is_current` affiliations across **different** orgs/offices (that's fine — the unique index only constrains per-office).
- **Org without a formal chart:** an affiliation may have `office_id = null` + a freeform `title` (a person at the org with no modeled office). Offices and freeform-title affiliations coexist.
- `clients.primary_contact`/`primary_contact_email` (free-text, pre-existing) are NOT migrated here; leave them. (A later pass could promote a flagged contact to "primary" — out of scope.)

---

## 3. Suggestions from meeting attendees (calendar → Contacts)

Reuse the P4.1 data: `meetings.external_attendees` (jsonb array of `{ email, name, domain }`, read with `parseStoredExternalAttendees`) + the domain→org map (`client_domains`, lower-cased unique; the builder in `apps/worker/src/lib/calendar-match.ts`).

- A **worker job** (`apps/worker/src/processors/contact-suggestions.processor.ts` + queue; nightly, and OK to also enqueue after a calendar scan) scans external attendees across meetings and, for each external email that is **not already a `contacts.email`** and **not already a pending/dismissed suggestion**, upserts a `contact_suggestions` row: `source='calendar_attendee'`, `suggested_name/email/domain`, `client_id` = domain→org match (or null if unknown/free-email — skip free-email via `@gracie/shared/domains` `isFreeEmailDomain`), `meeting_id` = provenance. The `uq_suggestion_dedup` index prevents spam.
- The Contacts UI shows **pending** suggestions; **Accept** → create a `contact` (+ an affiliation to the guessed org, `office_id` optional) and mark the suggestion `accepted`; **Dismiss** → `dismissed` (won't resurface).
- **n8n hook (design only, do NOT build):** n8n later inserts `contact_suggestions` rows with `source='n8n_web'` (e.g. "the VA CIO office looks vacant — here's a likely name"), optionally targeting a vacant `office_id`. Same inbox, same Accept/Dismiss.

---

## 4. Backend — data layer + API routes

**Data layer** — new `apps/web/lib/data/contacts.ts` (model on `apps/web/lib/data/clients.ts`: `import 'server-only'`, `getServerClient()`, typed `Insert`/`Update`, mappers in `apps/web/lib/mappers/contacts.ts`, throw `fn: message` on error). Functions (at least):
- Contacts: `listContacts({ clientId?, search?, includePast? })`, `getContact(id)` (with affiliations), `createContact`, `updateContact`, `deleteContact`.
- Offices: `listOffices(clientId)` (flat + a `buildOfficeTree` helper), `createOffice`, `updateOffice` (title/parent/is_key/sort), `deleteOffice`.
- Affiliations: `listAffiliationsForContact(contactId)`, `listAffiliationsForOrg(clientId)`, `createAffiliation`, `endAffiliation(id)`, `updateAffiliation`, `setOfficeHolder(officeId, contactId, ...)` (encapsulates the "end prior current holder" invariant).
- Suggestions: `listPendingSuggestions()`, `acceptSuggestion(id, {...})` (→ contact + affiliation), `dismissSuggestion(id)`.
- Export: `contactToCsvRow(contact, affiliations)` / `contactToVCard(...)`.

**API routes** — model on `apps/web/app/api/clients/[clientId]/domains/route.ts` (async `params: Promise<...>`, auth gate first, `{ error: { code, message } }` shape via a `fail()` helper, 201/400/404/500; no explicit `runtime` needed — defaults to Node):
- `apps/web/app/api/contacts/route.ts` — `GET` list (`?clientId=&search=&includePast=`), `POST` create. Editor-gated for writes.
- `apps/web/app/api/contacts/[contactId]/route.ts` — `GET`/`PATCH`/`DELETE`.
- `apps/web/app/api/contacts/[contactId]/export/route.ts` — `GET ?format=csv|vcard` → `text/csv` / `text/vcard` with `Content-Disposition: attachment; filename="…"` (mobile-friendly).
- `apps/web/app/api/contacts/[contactId]/affiliations/route.ts` (+ `[affiliationId]`) — create / end / update affiliations.
- `apps/web/app/api/clients/[clientId]/offices/route.ts` (+ `[officeId]`) — office CRUD (editor).
- `apps/web/app/api/clients/[clientId]/org-chart/route.ts` — `GET` → office tree + each office's current contact (for the visual), and vacant flags.
- `apps/web/app/api/clients/[clientId]/contacts/export/route.ts` — org-wide CSV.
- `apps/web/app/api/contact-suggestions/route.ts` (+ `[id]/accept`, `[id]/dismiss`) — editor.

---

## 5. Web UI

**Top-level `/contacts` page** (`apps/web/app/(app)/contacts/page.tsx`) — three areas (tabs or sections):
1. **All contacts** — searchable/filterable list (by org, current/past). Row → contact profile. "New contact" (editor).
2. **Org charts** — pick an org → the **visual office tree** (top-down; each node = office title + current contact chip **or "Vacant · add/link contact"**; `is_key` badge; expand/collapse). Add child office, edit office (title + **reports-to** picker + key flag) via forms. (Drag-drop reorg is optional/out-of-scope — form-based reparent is enough.)
3. **Suggestions** — the pending inbox (from §3); Accept / Dismiss.

**Contact profile** (`/contacts/[contactId]` or a drawer) — details + **affiliation history** (current + past, grouped by org, with office/title + dates) + **Download** button (CSV; offer vCard too — see §7). Editor can edit; viewer read-only.

**Nav:** add `{ label: 'Contacts', href: '/contacts', Icon: <lucide, e.g. Contact/Users2>, requires: 'contacts.view' }` to `NAV_ITEMS` in `apps/web/lib/navigation.ts`. Sidebar picks it up automatically.

**CSV export helper:** none exists — build one. Prefer the **server route** (§4) returning `text/csv` + `Content-Disposition: attachment` (most reliable on mobile). Include the contact's fields + a row/section per affiliation (org, office/title, dates, org email/phone).

Standard loading / saving / error / empty states throughout (match the P2.1 edit UX).

---

## 6. Permissions

Add to `packages/shared/src/constants/permissions.ts` — a string in `PERMISSIONS` **and** a row in `PERMISSION_MATRIX`:
- `contacts.view` — all roles (admin/standard/viewer true).
- `contacts.edit` — editor tier (admin+standard true, viewer false).

Gate the nav item + tabs with `requires: 'contacts.view'`; gate write **routes** with `isEditor(await getRequestUser())` (matches existing convention — there's no server `hasPermission` helper; you may call the shared `can(user.role, 'contacts.edit')` if you prefer symmetry). Client UI uses `useAuth().can('contacts.edit')` / `canEdit()` to show/hide edit affordances. Viewer is strictly read-only. No admin-only sensitive fields here (all contact data is editor-visible) — do **not** invent an admin gate unless the operator asks.

---

## 7. Out of scope (do NOT build)
- The **n8n** web-scan automation itself — only design the `contact_suggestions` queue so n8n can feed it later.
- Bulk CSV **import** of contacts (v1 is manual entry + calendar suggestions).
- Drag-and-drop org-chart reorg (form-based reparent is enough for v1).
- Migrating `clients.primary_contact*` into contacts / a "primary contact" promotion flow.
- Touching the calendar UI (suggestions live in Contacts), the AI pipeline, or the bot kill-switch (`calendar_bot_dispatch_enabled` stays OFF).

**Recommended (flag for the operator, small add):** also emit a **vCard (`.vcf`)** from the export route — it imports **straight into a phone's address book**, which is what "download to our phones" usually wants; CSV is the requested format, vCard is the better mobile companion. Ship both if quick; otherwise CSV first.

## 8. Acceptance (all before the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- Migration `0008` applied to the shared dev+prod Supabase **in coordination with the orchestrator** (additive + idempotent); generated types regenerated.
- **Offices:** create an org's offices incl. a **vacant** one; org chart renders the tree with "Vacant" nodes and `is_key` flags; reports-to hierarchy is correct.
- **Contacts + affiliations:** create a contact, affiliate to an org/office; **move them to another org** and the **history** shows both (prior ended, new current); a contact with two current orgs shows both.
- **Suggestions:** an external meeting attendee (P4.1 `external_attendees`) appears as a pending suggestion in the **Contacts** area (not the calendar); **Accept** creates a contact linked to the guessed org; **Dismiss** removes it and it doesn't resurface.
- **Export:** the profile **Download** button returns a CSV of the contact (+ affiliation history) that downloads on mobile.
- **Permissions:** viewer is read-only everywhere; editor can create/edit; the nav item respects `contacts.view`.
- Branch + **PR for review** (not `main`); `git status` shows no secrets staged.

## 9. Escalate (stop + ask the orchestrator) if
- Applying `0008` to the shared Supabase is risky, or the type regen churns unrelated types.
- The org-chart hierarchy or the multi-org/history invariants conflict with something in `docs/04` / P4.1.
- The suggestions generator would need to change the calendar scan or the P4.1 attendee shape.
- Scope threatens the gate (if the visual org chart balloons, ship the list + tree-data + vacant-office model first and flag the visualization for a follow-up — don't cut the data model).
