-- 0022_assistant_chats_pinned.sql — pin a conversation to the top of the sidebar.
--
-- The Assistant sidebar (Aug 21 review) grows a per-chat pin toggle: pinned chats
-- sort before everything else, then by recency within each group. This single
-- boolean backs that ordering; the list query becomes
-- `order by pinned desc, updated_at desc`.
--
-- Additive + idempotent (IF NOT EXISTS), NOT NULL DEFAULT false so every existing
-- row starts unpinned (auto-backfilled at ALTER time — no separate UPDATE). Applies
-- to the SHARED dev+prod Supabase — apply ONLY in coordination with the orchestrator
-- (same handling as 0015/0016/0017). packages/db/src/database.types.ts is hand-updated
-- with the matching assistant_chats.pinned Row/Insert/Update column.

alter table assistant_chats
  add column if not exists pinned boolean not null default false;
