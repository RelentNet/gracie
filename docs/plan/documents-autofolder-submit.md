# Documents: auto-create client folder on add + explicit Submit on upload

From the Aug 11 team-feedback review. Two small, additive Documents-area fixes.

## 1. A client shows up in Documents the moment it's added

**Allie:** "whenever we add a client it shows up under folders of clients for
documents, automatically, whether it has files or not."

**Why it was missing.** The global Documents tree is data-driven: its per-client
nodes come from `listDocumentOwnerOrgs()` — orgs that own **at least one** folder
or document (`apps/web/lib/data/documents.ts`). A brand-new client owns neither,
so it simply didn't appear until its first meeting doc or upload landed. (This
"doc-less orgs don't clutter the tree" behavior was a deliberate earlier fix; we
keep it — we just make a new client no longer doc-less.)

**Fix.** In `createClient` (`apps/web/lib/data/clients.ts`), after the client row
is inserted, create the client's top-level **"Generated Docs"** folder:

```
clients/<slug>/generated   displayName "Generated Docs"
```

- Placed in the **data layer**, so both callers get it: the add-client API
  (`POST /api/clients`) and the auto-org-from-meeting path (`createOrgFromMeeting`
  in `calendar.ts`).
- Uses the **exact path + display name the worker already files meeting docs
  under** (`generate.processor.ts` → `clients/<slug>/generated`), via the shared
  `findOrCreateFolder` primitive and the same `clientSlug()` used by the upload
  and new-folder routes. So the folder created at add-time is byte-identical to
  what a meeting would create — the worker's later `findOrCreateFolder` is a
  no-op, the 6 generated docs populate this same folder subtree, and no extra
  nesting level is introduced.
- **No empty doc rows** are pre-created — just the one folder, as specified.
- **Idempotent** by the unique `folders.path` — re-adds and the worker never
  duplicate it.
- **Scoped to real `client`s** (`type ?? 'client'`) — leads/prospects/internal
  keep the current "appear once they own docs" behavior, so the tree isn't
  cluttered with orgs that were never engaged.
- **Best-effort**: a folder hiccup is logged (`console.error`, matching the
  sibling `calendar.ts` pattern) and never fails the client create — the client
  row is the important part, and the worker recreates the folder on first
  generation regardless.

**Backfill (not required, noted).** Existing clients that already have meeting
docs already own this folder; existing clients with *no* docs won't get it
retroactively. If a one-time backfill is ever wanted, it's a single loop over
`type='client'` orgs calling the same `findOrCreateFolder` — idempotent, safe to
re-run. Not needed for the requirement to hold going forward.

## 2. Explicit "Submit" on the upload flow

**Ask:** choose file → fill metadata → an explicit **Submit** button to confirm,
so a wrong file can be corrected before it's filed.

`UploadModal.tsx` already implements exactly this flow (pick file(s), set
document type / title / status, then a single confirm button — nothing is filed
until it's pressed). The only gap was the label. Renamed the primary confirm
control **"Upload" → "Submit"** (and its busy state "Uploading…" → "Submitting…").
No behavior change: same metadata, same folder-target logic, same `POST /api/upload`.

## Verification

- `pnpm -r typecheck` — clean.
- `pnpm -r lint` — clean.
- `pnpm -r test` — green (worker 215/215).
- Live/preview verification skipped intentionally: a meaningful check requires
  creating a client, which mutates the **shared** dev DB (all-see-all). The
  change is a guarded, idempotent, best-effort folder create reusing existing,
  tested primitives.

Additive only; no migration. Respects folder ACLs (the new folder is default
`all` visibility, same as every other client folder) and all-see-all.
