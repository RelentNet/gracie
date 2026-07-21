# Delegation Brief — FIX: same-day meeting-folder collision (silent data loss)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §1 first.
> **Platform:** macOS, Node 24, pnpm. Worker `apps/worker`, DB `packages/db`. **This is a focused correctness fix — no new feature.**
> **Branch + PR. Do NOT push to `main`.** The **worker deploys separately** and this touches the (kill-switch-sensitive) generation pipeline.

---

## 0. The bug (real, unfixed on `main`, silent DATA LOSS)
`apps/worker/src/processors/generate.processor.ts` files a meeting's generated docs + transcript into **date-keyed, per-client paths that are NOT unique per meeting**, so **two meetings for the same client on the same day overwrite each other's MinIO objects** — no error, no version, the first meeting's bytes are gone.

Two collision points:
1. **`persistDocuments`** (`:248`): date folder `clients/<slug>/generated/<meetingDate>` (`:276-280`, `displayName=meetingDate`) + object keys **`clients/<slug>/generated/<meetingDate>/<type>.md`** (`:285`). A 2nd same-day meeting `putObject`s the SAME keys → overwrites; its `documents` rows insert alongside the 1st's rows, which now point at overwritten bytes.
2. **Transcript** (`:400`): **`clients/<slug>/transcripts/<meetingDate>.txt`** — same overwrite.
- Bonus bug: `meetingDate = meeting.date_time.slice(0, 10)` (`:256`,`:399`) is **UTC**, not ET — late-evening ET meetings can also land on the wrong day.

The existing idempotent-re-run clear (`delete documents where meeting_id=… and source_badge='meeting'`, `:259-263`) only protects **re-runs of the same meeting**; it does nothing for two *different* meetings.

**Why now:** meetings already record (manual join is proven) and auto-dispatch (`calendar_bot_dispatch_enabled`) is one flip from live — at which point same-day collisions become likely and lossy. Fix before that flip.

## 1. The fix (operator-approved spec)
Make the generated-docs folder + object keys + transcript key **unique per meeting**, and **ET-based**, while staying **deterministic** (so same-meeting re-runs remain idempotent — do NOT use wall-clock `now()`; derive everything from `meeting.date_time` + `meeting.id`).

- **ET stamp:** from `meeting.date_time`, compute `YYYYMMDD-HHMM` in **America/New_York**. Reuse/extend the ET helpers in `apps/worker/src/processors/daily-sync.processor.ts` (`ET='America/New_York'`, the eastern formatters) — add a small `easternStamp(iso)` if none fits. (Also use the ET *date* to replace the UTC `slice(0,10)`.)
- **Unique per-meeting folder + path:** `clients/<slug>/generated/<stamp>-<titleSlug>-<meetingId8>` where `titleSlug` = slugified `meeting.title` (reuse the `clientSlug` slugify approach, `:75`; fall back to `untitled`) and `meetingId8` = first 8 chars of `meeting.id`. This is the `findOrCreateFolder` `path` (unique key) — each meeting gets its own folder.
  - **Folder `displayName`:** `<Meeting Title> YYYYMMDD-HHMM` (ET), e.g. `Kickoff Call 20260716-1430` (title fallback: `Meeting`).
- **Object keys:** `clients/<slug>/generated/<stamp>-<titleSlug>-<meetingId8>/<type>.md` (under the unique path).
- **Transcript key:** unique per meeting, e.g. `clients/<slug>/transcripts/<stamp>-<meetingId8>.txt`.
- **Determinism/idempotency:** because the stamp comes from `meeting.date_time` (not `now`), a re-run of the same meeting resolves the SAME path/keys → the existing clear-by-`meeting_id` + `findOrCreateFolder` keep re-runs idempotent. Verify a re-run does not create a second folder.
- Keep everything else (doc types, embeddings, master record, tasks) unchanged.

## 2. Backfill (flagged migration — orchestrator applies, NOT the session)
Existing `clients/<slug>/generated/<date>` folders keep their old paths/keys (do NOT rewrite historical `r2_key`s — that would break stored objects). Only improve the **`display_name`** of **single-meeting** old date folders so the UI reads meaningfully:
- Add a numbered migration **`0011`** (0010 is the last applied; 0011 was reserved-but-never-applied — safe to use). Additive/idempotent, **flagged**.
- For each folder whose `path` matches `clients/%/generated/<YYYY-MM-DD>` AND whose documents all share **exactly one** `meeting_id`: set `display_name` = `<that meeting's title> <YYYYMMDD-HHMM ET>` (ET via `to_char(m.date_time AT TIME ZONE 'America/New_York', …)`).
- **Leave collided folders** (folders whose docs span >1 `meeting_id`) untouched — their data was already merged/lost and can't be split; the migration must not touch paths/keys.
- Hand-regen `packages/db/src/database.types.ts` only if you add columns (you shouldn't — this is data-only). **Do NOT apply it** — the orchestrator applies migrations after review.

## 3. Gate + safety
- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + worker tests if any touch this path.
- **Prove it:** simulate/verify two meetings, same client, same ET day → two distinct folders + distinct object keys + distinct transcript keys, no overwrite; and a re-run of one meeting is idempotent (no dup folder, docs replaced).
- Worker-only change (+ the flagged 0011 backfill) — **do not touch** the web app, kill-switches, or the webhook contract. No secrets staged.
- The generation pipeline is idempotent per meeting and kill-switch-sensitive — preserve both.

## 4. PR notes
- The unique-path scheme + the ET stamp source (`meeting.date_time`, deterministic); confirm re-run idempotency.
- Both collision points fixed (docs keys + transcript key) + the UTC→ET date fix.
- Migration `0011` added (backfill, display_name-only, single-meeting-only, collided folders skipped) — **unapplied**, flagged for the orchestrator.
- Confirm no historical `r2_key` was rewritten.
