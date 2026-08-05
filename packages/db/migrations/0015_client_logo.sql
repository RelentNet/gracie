-- 0015_client_logo.sql — per-client logo shown instead of the initials chip.
--
-- Mirrors the firm-wide brand-logo pattern (#86), but per client: an editor
-- uploads a PNG/JPG/SVG on the client's Overview → Client Details card; the bytes
-- go to MinIO under `clients/<clientId>/logo-<ts>.<ext>` and are served through
-- the same-origin `/api/clients/:id/logo` proxy (SVG served safely, <img> only).
-- This column just holds the MinIO object KEY; null = no logo → the initials
-- avatar (clients.initials) renders as before.
--
-- Additive + idempotent (add column if not exists). Applies to the SHARED
-- dev+prod Supabase — DO NOT apply unilaterally; apply ONLY in coordination with
-- the orchestrator (same handling as 0013/0014). packages/db/src/database.types.ts
-- is hand-updated with the matching clients.logo_key Row/Insert/Update column.

alter table clients add column if not exists logo_key text;
