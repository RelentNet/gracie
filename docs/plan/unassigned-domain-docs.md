# Unassigned meetings → domain-named document area + filter

**Branch:** `feat/unassigned-domain-docs` · **Migration:** `0018_client_type_unassigned.sql` (additive)

## Problem
When a recorded meeting has no matched client, `generate.processor.ts` used to *hold*
it (#87): transcript captured, but doc generation deferred and the meeting parked at
`pipeline_status='cancelled'`. The notes were effectively invisible — there is no
client in the roster to file them under, so nobody could find them.

## What this does
Makes those notes visible/findable without cluttering the real client roster.

1. **Worker files unlinked-meeting docs under a DOMAIN-NAMED placeholder org.** When
   `resolveMeetingClientId` returns `skip`, the processor now derives the meeting's org
   domain from `external_attendees` and files everything under a lightweight
   `type='unassigned'` client whose **name is the domain** (e.g. `aperimeter.com`). The
   entire existing pipeline then runs unchanged (folders, documents, embeddings, tasks,
   master record, notifications) — the docs land in a real, named area. If **no** org
   domain can be derived (no external attendees, or only internal/free-email), it falls
   back to the existing #87 hold.

2. **Clients → "Unassigned" tab.** A new party tab surfaces the domain placeholders via
   the existing `GET /api/clients?type=unassigned` (no API change — `resolveTypes`
   already accepts any `CLIENT_TYPES` value). Kept off the real roster (Clients /
   Prospects / Leads / Partners) so it doesn't clutter. The "Add" button is hidden on
   this tab (placeholders are auto-created, never hand-made).

3. **Documents browser surfaces the areas automatically.** The global tree is built from
   the type-agnostic `/api/documents/orgs` (one node per org that owns a doc, any type),
   so a placeholder with generated docs appears as a node labeled by its domain — no
   browser change needed.

## Key design decisions
- **A real `clients` row, not `client_id = null`.** `master_record_entries.client_id`
  is NOT NULL and the whole pipeline is client-scoped, and the documents tree keys nodes
  by owner-org id. A `type='unassigned'` client is the smallest vehicle that reuses 100%
  of the existing pipeline + browser with zero downstream changes.
- **NOT registered in `client_domains` (deliberate).** The domain stays "unknown", so the
  operator's existing "create a real client from this domain" flow and the
  ambiguous-meetings prompt keep firing. The placeholder is a visibility bucket, not a
  claim on the domain.
- **Idempotent find-or-create in app code (select-first), no unique index.** A partial
  index `where type='unassigned'` can't reference the enum value in the same migration
  that adds it (see 0009's ADD-VALUE note), so uniqueness is enforced by the select-first
  check. Two generate jobs racing on a brand-new domain could make a duplicate
  placeholder — a rare, cosmetic-only dup (add the partial index in a follow-up migration
  if it ever actually happens). Marked with a `ponytail:` comment.

## Known ceiling (out of scope)
If the operator later creates/links a **real** client for one of these meetings,
generate-on-link won't regenerate under it (the meeting already has docs), so the notes
stay under the placeholder area. The operator can promote a placeholder to a real client
by editing its type, or re-run from the Pipeline. Moving docs on relink was not requested.

## Files
- `packages/db/migrations/0018_client_type_unassigned.sql` — `ALTER TYPE client_type ADD VALUE 'unassigned'` (additive).
- `packages/db/src/database.types.ts` — hand-regenerated `client_type` (union + array).
- `packages/shared/src/constants/enums.ts` — `unassigned` in `CLIENT_TYPES` + doc.
- `apps/worker/src/processors/generate.processor.ts` — `pickUnlinkedDomain` (pure),
  `findOrCreateDomainClient`, `resolveUnlinkedDomainClient`; rewired the `skip` branch.
- `apps/worker/src/processors/generate.processor.test.ts` — 5 `pickUnlinkedDomain` tests.
- `apps/web/app/(app)/clients/page.tsx` — "Unassigned" tab + hint + hide Add.
- `apps/web/components/client/ClientDetailsCard.tsx` — `unassigned` label; excluded from the manual type picker.
- `apps/web/app/(app)/contacts/shared.tsx` — `unassigned` badge style.

## Gate
`pnpm -r typecheck` ✓ · `pnpm -r lint` ✓ · worker tests 177/177 ✓ · web tests 55/55 ✓.

## Deploy
Additive migration `0018` must be applied (shared Supabase, via the orchestrator), then
redeploy web + worker. No data backfill: existing held meetings re-file under a domain
area on their next generation run (e.g. re-run from Pipeline).
