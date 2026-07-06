-- 0005_internal_onmicrosoft_domain.sql (P4.1 follow-on — GA tenant routing domain)
--
-- `graceandassociatescom.onmicrosoft.com` is Grace & Associates' own Microsoft 365
-- tenant routing domain (INTERNAL), but 0004 seeded only `graceandassociates.com`,
-- so meetings whose only non-GA attendee was on the onmicrosoft domain were
-- treated as EXTERNAL and surfaced it as an "unknown org" (~31 meetings). Adding
-- it to the configurable internal-domain list makes those meetings reclassify:
-- attendees on it count as internal, GA-tenant-only meetings become
-- `is_internal = true` (homed to the GA org), and it never appears as an
-- unknown-org "create client" target again.
--
-- Storage format MATCHES 0004: `settings.value` is jsonb and scalar settings are
-- stored JSON-encoded via `to_jsonb('...'::text)` (a JSON string). The reader
-- (`loadInternalDomains` / `loadScanContext`) does
-- `typeof value === 'string' ? value : null` then `parseInternalDomains`, which
-- splits a COMMA-SEPARATED string — so the value stays one JSON string with the
-- two domains comma-joined. Do NOT switch to a jsonb array; it would break the read.
--
-- Idempotent: re-applying sets the same canonical value. NOTE (operator): this
-- unconditionally overwrites `internal_email_domains` with the canonical two-domain
-- list — apply only if that list is complete for this tenant.

insert into settings (key, value)
values (
  'internal_email_domains',
  to_jsonb('graceandassociates.com,graceandassociatescom.onmicrosoft.com'::text)
)
on conflict (key) do update set value = excluded.value;
