-- 0021_contacts_outlook_import.sql — tag + hold imported Outlook/Office 365 contacts.
--
-- The admin-triggered "Import from Outlook" flow (MS Graph, app-only) pulls a
-- mailbox's Outlook contacts into `contacts`. Three additive columns give the
-- imported business-card data a home and make imports identifiable/bulk-manageable:
--   * source  — provenance tag, e.g. `outlook:joe@graceandassociates.com`. Lets an
--               operator later find/manage everything a given import created.
--   * company — the Outlook `companyName` kept as a PLAIN LABEL on the contact when
--               it does not match an existing org (we never auto-create orgs). When
--               it DOES match, a light `contact_affiliations` row is added too.
--   * title   — the Outlook `jobTitle` (business-card role). Also copied onto the
--               matched-org affiliation when one is created.
--
-- All nullable, no backfill, no index (the table is small; add one only if it
-- grows). Additive + idempotent (IF NOT EXISTS). Applies to the SHARED dev+prod
-- Supabase — apply ONLY in coordination with the orchestrator.
alter table contacts add column if not exists source  text;
alter table contacts add column if not exists company text;
alter table contacts add column if not exists title   text;
