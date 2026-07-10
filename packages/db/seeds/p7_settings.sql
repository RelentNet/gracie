-- p7_settings.sql — P7 config seed (DATA, not DDL).
--
-- P7 (Briefs · Daily Sync · Notifications) requires NO schema migration: all
-- tables + enums already exist. It only seeds a few `settings` rows. This is
-- deliberately NOT a numbered migration — migration 0008 is reserved for the
-- Contacts phase (docs/plan p7 §0). Apply it via the same `/pg/query` path used
-- for prior migrations, or `psql -f`.
--
-- Storage format MATCHES 0004/0005: `settings.value` is jsonb and scalar settings
-- are stored JSON-encoded via `to_jsonb('...'::text)` (a JSON string). The worker
-- readers do `typeof value === 'string' ? value : null` then parse.
--
-- Idempotent + NON-CLOBBERING: `on conflict do nothing` so re-applying never
-- overwrites a value the operator has since tuned (e.g. a narrowed allowlist, a
-- changed send hour). To CHANGE a value later, update it directly — not here.

-- ⚠️ HARD SAFETY (docs/plan p7 §3): the outbound-email allowlist. Gracie may only
-- ever email @graceandassociates.com. This is SEPARATE from internal_email_domains
-- (which includes the onmicrosoft routing domain — a real tenant domain but NOT a
-- mailbox we may email). NEVER widen this beyond graceandassociates.com; escalate.
insert into settings (key, value)
values ('email_allowed_domains', to_jsonb('graceandassociates.com'::text))
on conflict (key) do nothing;

-- Daily sync (all active staff, ~6 AM ET). enabled + wall-clock hour in ET.
insert into settings (key, value)
values ('daily_sync_enabled', to_jsonb('true'::text))
on conflict (key) do nothing;

insert into settings (key, value)
values ('daily_sync_hour_et', to_jsonb('6'::text))
on conflict (key) do nothing;

-- Pre-meeting briefs (generated morning-of, bundled into the daily-sync email).
insert into settings (key, value)
values ('pre_meeting_briefs_enabled', to_jsonb('true'::text))
on conflict (key) do nothing;

-- KB-expiry alert lead time (days before expiration_date to alert admins).
insert into settings (key, value)
values ('kb_expiry_warning_days', to_jsonb('14'::text))
on conflict (key) do nothing;

-- Relationship-health at/below which a client is surfaced as "at risk" in the sync.
insert into settings (key, value)
values ('at_risk_health_threshold', to_jsonb('50'::text))
on conflict (key) do nothing;
