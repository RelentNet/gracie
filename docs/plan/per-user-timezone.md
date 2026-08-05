# Per-user time zones — device-local UI, profile-tz email

**Status:** built on `feat/per-user-timezone` (PR open, not merged).
**Migration:** `0017_users_timezone.sql` — additive, NOT yet applied (coordinate with the orchestrator). (Renumbered from 0016 after #104 `0016_meeting_stills` merged first.)

## The decision (operator)

Today everything renders US Eastern. Cynthia is Central; several users travel.

- **App UI → the viewer's DEVICE / browser-local time.**
- **The daily-sync EMAIL → a settable per-user profile timezone** (email is
  server-rendered and can't read the device at open). Fallback `America/New_York`.

Canonical timestamps stay UTC/ISO everywhere — this only changes the wall-clock a
value is *displayed* in.

## What shipped

### 1. Profile timezone field + self-service + browser default
- `users.timezone text NULL` (IANA id; null → `America/New_York`). Migration
  `0017`, DB types hand-updated.
- Data layer (`lib/data/users.ts`): `getTimezoneByLogtoId`, `setTimezoneByLogtoId`.
- Self-service endpoint `PATCH/GET /api/profile/timezone` — **any role, self only**
  (keyed off the verified session, never a client-supplied id). IANA validated at
  the route (`lib/timezones.ts` `isValidTimeZone`, via `Intl`).
- Control: **Calendar page → Connection panel → "Your timezone"** dropdown
  (`calendar/components/TimezoneSetting.tsx`), the established home for per-user
  prefs (alongside "auto-join meetings I lead"). Curated common-zone list; the
  user's current + browser-detected zones are always injected so any valid IANA id
  stays selectable.
- Auto-default: `components/TimezoneAutoDefault.tsx` mounted in the `(app)` shell.
  On first load, if the signed-in user has no zone yet, it PATCHes the browser's
  `Intl.DateTimeFormat().resolvedOptions().timeZone`. Silent, one-shot, best-effort.

### 2. App UI → device-local (`lib/format.ts`)
The helpers keep their names/signatures (no repo-wide rename); the implementation
changed. New rule via `resolveTimeZone(zone)`:
- explicit `zone` wins;
- else on the **client** → `undefined` → Intl uses the **device's local zone**;
- else on the **server** → `DEFAULT_TIME_ZONE` (`America/New_York`), the profile
  fallback.

`formatEasternDateTime`/`formatEasternDate` are now back-compat **aliases** of
`formatDateTime`/`formatDate` — they no longer pin Eastern unconditionally; Eastern
is only the SSR fallback. Every existing call site is therefore zero-regression:
client callers still render device-local, and untouched server callers still render
Eastern. Server components that should follow the viewer opt in by passing the
profile zone.

### 3. Daily-sync email → profile timezone
- Template (`email-templates/daily-sync.ts`): `DailySyncEmailInput.timeZone`
  threads into every meeting clock time (`formatClockTime`, null → Eastern).
- Processor (`daily-sync.processor.ts`): loads each user's `timezone` and renders
  their email in their own zone. The subject + header **date label** stays the ET
  business date of the digest (see below).

## Path table — device-local vs profile-tz vs ET fallback

| Surface | Renders in |
|---|---|
| All client components (`formatDate`/`formatDateTime`; every current caller is a client component) | **device-local** (browser) |
| Dashboard "today" header + today's-meeting times | viewer's **profile tz** (SSR) |
| Meeting occurrence page — the prominent meeting start date+time | viewer's **profile tz** (SSR) |
| Client → Meetings tab — meeting times | viewer's **profile tz** (SSR) |
| Daily-sync page — meeting times + generated/emailed timestamps | viewer's **profile tz** (SSR) |
| Daily-sync **email** — meeting clock times | each recipient's **profile tz** |

## Timestamps intentionally left on the ET fallback (and why)

- **Daily-sync business-date label** — the page header ("generated ~6:00 AM
  Eastern"), the in-app `dateLabel`, and the email subject/header date. This is the
  digest's canonical identity (one ET business day, shared across all recipients and
  the stored `daily_syncs` row); per-recipient dating would desync the subject from
  the record.
- **Date-only labels with no clock** — prior-meeting dates and task due-dates
  (`YYYY-MM-DD` anchored at noon UTC). The tz "wrong hour" bug doesn't apply to a
  bare date; they'd differ only in a rare near-midnight boundary, so they keep the
  ET fallback rather than prop-drilling a zone three component layers deep.

## Notes / ceilings

- Local mock auth: the profile PATCH route keys by `logto_id`, so a set/auto-default
  no-ops (404) under mock — identical to the sibling `/api/calendar/auto-join`
  behavior; real Logto sessions work normally.
- SSR pages are static server HTML; they render in the **profile** zone, not the
  live device zone. Since the profile zone is auto-defaulted from the browser on
  first load, it tracks the device for non-travelers. A traveler who wants SSR
  timestamps to follow them updates "Your timezone".

## Test
`apps/web/lib/format.test.ts` — `resolveTimeZone` (explicit / null / empty →
fallback) and `formatDateTime`/`formatDate` (UTC instant + zone → expected clock,
cross-zone, SSR fallback, day-boundary, invalid → empty).
