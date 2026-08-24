# PostHog product analytics (client-side, privacy-first)

Branch `feat/posthog-analytics` · scope `apps/web` only · **no migration, no worker, no new backend routes.**

## Goal

See pageviews / feature usage / per-user activity in PostHog, following PostHog's
official Next.js **App Router** pattern. Fully non-technical-operable and resilient:
**if the key is absent the app behaves EXACTLY as today** — no init, no errors, no crash.

## What shipped

| File | Purpose |
| --- | --- |
| `apps/web/components/analytics/PostHogProvider.tsx` | `'use client'` provider: one-time init, manual pageview tracker, identify. |
| `apps/web/lib/analytics.ts` | `capture(event, props?)` — safe no-op until PostHog is initialized. |
| `apps/web/lib/analytics.test.ts` | Unit test: `capture` no-ops (never reaches `posthog.capture`) when uninitialized. |
| `apps/web/app/layout.tsx` | Mounts `<PostHogProvider user={…}>` around the app tree. |
| `apps/web/package.json` | Adds `posthog-js@^1.418.14`. |

## Design decisions

- **Init gate (the resilience contract):** `posthog.init()` runs only when
  `process.env.NODE_ENV === 'production'` **AND** `NEXT_PUBLIC_POSTHOG_KEY` is a
  non-empty string, client-side, once (`posthog.__loaded` guard). So local dev never
  pollutes the dashboard, and a missing key is a clean no-op — PostHog stays
  uninitialized and every downstream call (`capture`, `identify`, pageview) no-ops.
  The `NODE_ENV` gate was **not** weakened to allow local verification (per brief).
- **Pageviews (App Router):** `capture_pageview: false` + a `<PageView>` tracker that
  fires `$pageview` on route change via `usePathname` + `useSearchParams`, wrapped in
  `<Suspense fallback={null}>` (searchParams forces a Suspense boundary or static
  generation breaks). Verified: `next build` prerenders the static routes with no
  Suspense/CSR-bailout warning.
- **Identify:** the root layout already resolves the session user (`getCurrentUser()`
  → mock in dev, Logto in prod) for `AuthProvider`; we pass a trimmed
  `{ id, email, name, role }` into the provider, which calls
  `posthog.identify(id, { email, name, role })`. Skips the guest placeholder
  (`id === 'guest'`) and empty-email / logged-out routes. Distinct id = the Logto
  subject (`AuthUser.id`), stable across sessions.
- **Privacy (this app holds client transcripts / contacts / financials):**
  - `disable_session_recording: true` — **no** screen replay.
  - `autocapture: true` — element-level clicks/pageviews only; **no** full-text or
    session capture enabled.
  - `respect_dnt: true` — **decision:** honor the browser Do-Not-Track signal
    (privacy-first default for this data class).
- **Helper (`capture`):** thin wrapper that early-returns unless `posthog.__loaded`,
  so custom events can be sprinkled at call sites later. No speculative events
  instrumented now (autocapture + pageview + identify is v1).

## Gate

`pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ (max-warnings 0) · `pnpm --filter web test` ✅
(91/91, incl. the new `capture` no-op test) · `next build` ✅ (only the pre-existing
`unpdf` `import.meta` warning, unrelated).

Browser preview needs Logto + the LAN backend (unreachable in the build env) and init
is prod-gated, so the green gate + a full production build are the verification.

## Deploy note (IMPORTANT)

`NEXT_PUBLIC_*` env vars are **inlined at BUILD time**. The web container must have
`NEXT_PUBLIC_POSTHOG_KEY` **and** `NEXT_PUBLIC_POSTHOG_HOST` set in **Coolify's build
env** *before* the redeploy, or the token won't be in the bundle and analytics stays a
no-op (safe, but silent). No DB step; web redeploy only (worker untouched).
