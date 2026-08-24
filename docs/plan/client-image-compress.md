# Client-side image compression (dodge the edge-proxy body limit)

## Problem (proven)

The office edge proxy (Nginx Proxy Manager / openresty) returns **500 on any
HTTP request body over ~10 KB** — it can't buffer larger bodies. The Coolify VM
and the app itself handle 150 KB fine; only the public proxy path fails, and we
**cannot change the proxy from the app**.

Two admin upload flows send image bodies well over that:

1. **Brand logo** — `settings/CompanySettingsPanel.tsx` → multipart POST `/api/brand/logo`.
2. **Bot avatar** — `settings/BotSettingsPanel.tsx` → PATCH `/api/settings/bot` with `{ avatar: { jpegB64 } }`.

Both are small display images (a nav logo; a Recall video tile), so there is no
reason to ship full-size bytes.

## Fix

Compress the chosen image **in the browser** to under ~6 KB (≈8 KB base64, well
inside the ~10 KB buffer) **before** sending. **Server routes are unchanged.**

New shared util `apps/web/lib/image-compress.ts`:

- Loads the file into an `<img>`, downscales preserving aspect ratio (caps the
  longest edge), draws to a canvas, and re-encodes — iterating JPEG quality down,
  then dimensions down, until the encoded bytes are under the budget.
- **Format:** `format: 'jpeg'` forces JPEG (avatar — Recall requires JPEG, and
  the server validates JPEG magic bytes). `format: 'auto'` (logo) emits **PNG if
  the source has transparency** (alpha scan on a small draw), else **JPEG**.
- **Pass-through** (no re-encode) for SVGs (vector — canvas can't emit SVG, and
  they're near-always tiny) and for any file already under budget.
- Returns `{ blob, dataUrl, type }` so the logo can post the `Blob` as the
  multipart file and the avatar can send the base64 `dataUrl`.

Wiring:

- **Logo** (`CompanySettingsPanel.tsx`): `compressImage(file, { maxEdge: 320 })`
  before building the `FormData`; the compressed `Blob` is wrapped in a `File`
  with the matching extension. Best-effort — on compression failure it falls back
  to the original file (no worse than today).
- **Avatar** (`BotSettingsPanel.tsx`): `compressImage(file, { maxEdge: 256, format: 'jpeg' })`
  replaces the raw `FileReader.readAsDataURL`; the resulting JPEG data URL feeds
  the existing `pendingDataUrl` → `{ jpegB64 }` path unchanged.

Existing client-side size/type validation is kept in both flows.

## Scope / limits

- Fixes **logo + avatar** only. **Document uploads still require the proxy fix** —
  arbitrary files (PDFs, docs) can't be compressed this way.
- `ponytail:` a transparent-PNG logo that stays above budget even at the 48px
  edge floor is returned as-is (best effort). Rare for a real logo; upgrade path
  is flatten-onto-white → JPEG (loses transparency).

## Verification

- `pnpm -r typecheck` — green.
- `pnpm -r lint` — green.
- `pnpm --filter web test` — 71 pass (incl. 4 new `scaledDimensions` checks).
  The canvas/encode path needs a browser, so only the pure aspect-ratio math is
  unit-tested.
