# Clients — four party tabs (Aug 11 review)

Rework the Clients roster to **exactly four party tabs**, in order, alphabetical
within each tab:

1. **Clients** — `client`
2. **Partners** — `partner` **+ `unassigned`** (the worker's domain-named
   placeholder orgs for unmatched recorded meetings now default here instead of a
   separate "Unassigned" tab)
3. **Past clients** — new type `past_client`
4. **Prospective clients** — `prospect` **+ `lead`** (leads == prospects; the
   `lead` enum value stays valid, it just displays under this tab)

Internal (the single GA workspace) stays separate, linked out beside the tabs.

## What changed

- **New enum value `past_client`** (additive):
  - `packages/db/migrations/0019_client_type_past_client.sql` —
    `alter type client_type add value if not exists 'past_client'` (idempotent, tx-safe).
  - `packages/shared/src/constants/enums.ts` — appended to `CLIENT_TYPES`.
  - `packages/db/src/database.types.ts` — hand-regen: added to the `client_type`
    union and to the runtime `Enums.client_type` array.
  - Exhaustive `Record<ClientType>` maps updated: `ClientDetailsCard.tsx`
    (`TYPE_LABELS`) and `contacts/shared.tsx` (`ORG_TYPE_STYLE`), both `'Past client'`.
  - `calendar/lib/calendar-meeting.ts` `orgTypeLabel` — one-line case so a
    `past_client`-typed org labels as "Past client" (not the `?? 'Internal'` fallback).

- **Tabs** (`apps/web/app/(app)/clients/page.tsx`): `PARTY_TABS` is now four entries,
  each carrying a `types` set. The active tab fetches all its types in one request
  (`?type=partner,unassigned`). Removed the old Prospects/Leads/Partners/Unassigned
  tabs and the `party === 'unassigned'` special-casing (header copy + hidden Add
  button). List is now sorted `name.localeCompare` (alphabetical within each tab).

- **API** (`apps/web/app/api/clients/route.ts`): `resolveTypes` now accepts a
  comma-separated `?type=` list (splits, filters against `CLIENT_TYPES`), in addition
  to the existing `all` / single-value / absent cases. Backward compatible.

- **Add modal** (`AddClientModal.tsx`): party options are now Client / Prospective
  client / Partner / Past client (dropped the redundant "Lead"; relabeled Prospect).
  Keeps the Past-clients tab's Add button coherent (defaultType has a matching option).

## Re-assignment

Existing edit path is unchanged: `ClientDetailsCard`'s type picker offers every type
except `internal`/`unassigned`, so an org is moved to Past clients (or any tab) by
editing its type. Demoting a live client → `past_client` is the intended path.

## Migration

**Migration `0019_client_type_past_client.sql` needs applying** to the shared
dev+prod Supabase (coordinate with the orchestrator). Additive only — no destructive
or rename operation, no enum value removed.

## Verification

`pnpm -r typecheck` ✓, `pnpm -r lint` ✓, web tests 66/66 ✓, worker tests 215/215 ✓.
Live preview of the authenticated `/clients` page was not done — no `launch.json` and
the page sits behind Logto SSO (not reachable headlessly). Change is presentational +
additive-enum and fully type-checked.
