# Dark-mode brand logo variant

## Why
The platform-wide indigo/glass redesign (#95) added a light/dark theme toggle.
A navy/dark brand logo uploaded for the light theme washes out on the dark
surface. This adds a SECOND, optional "dark mode" logo. The sidebar shows the
light logo in light theme and the dark logo in dark theme; if no dark variant is
uploaded, the light logo is used in both (behavior unchanged from before).

## Scope
Additive only. **No migration** — the dark logo is a new scalar-string
`settings` row (`brand_logo_dark_key`), the same pattern as `brand_logo_key` /
`internal_email_domains`. Admin-only upload, unchanged size/type/SVG-safety
rules. All staff see the resulting logo (access model unchanged).

## What changed (files)
- **`apps/web/lib/data/branding-settings.ts`** — factored the read/write into
  `readKey`/`writeKey` helpers; kept `getBrandLogoKey`/`setBrandLogoKey` and
  added `getBrandLogoDarkKey`/`setBrandLogoDarkKey` over the new
  `brand_logo_dark_key` setting.
- **`apps/web/app/api/brand/logo/route.ts`** — a `variant` param (`light` |
  `dark`) selects which key/object the request targets:
  - `GET ?variant=dark` streams the dark logo (404 until one is uploaded); no
    variant / `light` is the existing main logo, unchanged.
  - `POST`/`DELETE` read `variant` from a form field first, then a query param,
    defaulting to `light`. Unknown values resolve to `light` (`resolveVariant`)
    so a bad string can never write an unexpected key. Dark objects are stored
    under `branding/logo-dark-<ts>.<ext>`.
  - Admin-only, 1 MB cap, PNG/JPG/SVG, and the SVG nosniff+sandbox headers are
    identical across variants (shared code path via a `VARIANT_IO` map).
- **`apps/web/lib/auth.tsx`** — added `brandLogoDarkKey` to the auth context
  (mirrors `brandLogoKey`), hydrated once server-side, no client fetch.
- **`apps/web/app/layout.tsx`** — reads `getBrandLogoDarkKey()` alongside the
  main key (fail-open to `null`) and passes it to `AuthProvider`.
- **`apps/web/styles/theme.css`** — theme-conditional `.logo-light` /
  `.logo-dark` display rules (see mechanism below).
- **`apps/web/components/Sidebar.tsx`** — when a dark logo exists, renders BOTH
  `<img>` tagged `.logo-light` / `.logo-dark`; when it doesn't, renders the
  single untagged `<img>` exactly as before.
- **`apps/web/app/(app)/settings/CompanySettingsPanel.tsx`** — the logo
  upload/preview logic became a small reusable `LogoField` rendered twice: the
  main logo and "Dark mode logo (optional)" with the one-line explanation
  "Shown on dark backgrounds; if left empty, your main logo is used everywhere."

## Theme mechanism used (no JS, no flash)
Reuses the exact cascade #95 established in `theme.css`. The in-app toggle stamps
`data-theme` on `<html>`, and an inline `<head>` script sets it before first
paint (so no flash), defaulting to `prefers-color-scheme`. The logo rules mirror
the palette selectors 1:1:
- default / `[data-theme="light"]` → `.logo-light` visible, `.logo-dark` hidden;
- `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` AND, at
  higher specificity, `:root[data-theme="dark"]` → `.logo-dark` visible,
  `.logo-light` hidden.
Both images are in the DOM, so the correct one is shown before hydration and the
toggle flips them with pure CSS — no client JS, no flash.

## No-dark-variant fallback
Resolved server-side: the Sidebar reads both keys. When `brandLogoDarkKey` is
`null` it renders a single untagged `<img>` pointing at the main logo — byte-for-
byte the previous single-logo behavior in both themes. The theme-conditional CSS
is inert in that case (nothing carries `.logo-dark`).

## Gate results
- `pnpm -r typecheck` — clean.
- `pnpm -r lint` — clean (`--max-warnings 0`).
- `pnpm --filter web test` — 48/48 pass (no new tests: `resolveVariant` is a
  trivial ternary; the data-layer functions need a live DB).
- `pnpm --filter web build` — full production build succeeded.

## Not done / manual
- Visual confirmation on the real nav needs the LAN backend + an uploaded dark
  logo; reasoned from the theme CSS instead. No deploy performed.
