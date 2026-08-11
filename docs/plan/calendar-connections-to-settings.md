# Move calendar connections off the calendar into Settings → Users

## Why
Operator wants the Calendar page to show only the agenda + grid. The connection
panel (Sync-now, team roster/status, per-user "auto-join meetings I lead", per-user
timezone) is not calendar-specific — it's connection status + personal preferences,
so it belongs in Settings → Users alongside the admin user roster.

## What changed
- **Moved** `calendar/components/ConnectionPanel.tsx` → `settings/CalendarConnectionPanel.tsx`
  (renamed the component `ConnectionPanel` → `CalendarConnectionPanel`).
- **Moved** `calendar/components/TimezoneSetting.tsx` → `settings/TimezoneSetting.tsx`
  (it was rendered inside the connection panel; it travels with it).
- **Removed** the `onSynced` prop and its call — in Settings there's no calendar to
  reload, so Sync-now now just refreshes its own status. `isAdmin` gating is unchanged.
- **Inlined** the one-line `ConnectionsResponse` type into the moved panel (it was the
  panel's only consumer) and **deleted** it + its now-unused `CalendarConnectionStatus`
  import from `calendar/types.ts`.
- **Calendar page** (`calendar/page.tsx`): dropped the `ConnectionPanel` import + usage
  and refreshed the layout docstring. `isAdmin` stays (still gates the ambiguous-meeting
  pointer + bot config).
- **Settings → Users** (`UsersPanel.tsx`): renders `<CalendarConnectionPanel isAdmin={…} />`
  above the user roster. `isAdmin` is computed with the same `can('calendar.configure')`
  gate the calendar page used, so Sync-now / full-roster visibility is byte-for-byte
  preserved. The roster's loading/empty/error branches were refactored into a `roster`
  node so the connection card stays visible even if the `/api/settings/users` fetch is
  loading or fails (the two are independent fetches).

## Behavior preserved
Sync-now (+ poll-until-synced), roster/status list, the auto-join toggle, and the
timezone control all call the same endpoints as before and work identically.

## Not touched
The two admin master switches (global bot kill-switch + on-demand join) already live
under Settings → Meeting Bot — left alone.

## Verification
`pnpm -r typecheck` ✅ · `pnpm -r lint` (--max-warnings 0) ✅ · `apps/web` tests 66/66 ✅.
Preview not run: Settings is Logto-auth-gated against the LAN backend, not reachable
headlessly from this worktree. Change is a pure component relocation with no logic
change, so typecheck/lint/tests cover it.

## UX note for the reviewer
The Users tab now mixes a **per-user preference** (timezone, auto-join) with the
**admin user-management** roster. Confirm that placement reads right — an alternative
is a dedicated "Calendar" settings tab, but per the brief this lives in Users.
