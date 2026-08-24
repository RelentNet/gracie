# Documents three-pane default split rebalance

From the Aug 21 review (Allie's "bug herd"): the Documents three-pane browser
felt off-balance — the folder/tree panel too narrow, the file list hogging the
middle, the preview too cramped.

## Change (presentational only)

`apps/web/components/FileBrowser/DriveBrowser.tsx` — rebalanced the **default**
column proportions of the desktop (`lg`) three-pane grid:

- **LEFT** (folders/tree/client list): `16rem` → **`20rem`** (256 → 320px).
  Bumped both the grid template (`lg:grid-cols-[…]`) and the `TREE_COLUMN_WIDTH`
  constant that the resize clamp reserves, so they stay in sync.
- **PREVIEW** (right pane): default `480` → **`600px`** (`DEFAULT_PREVIEW_WIDTH`).
- **MIDDLE** (file list / "no files" area): `minmax(0,1fr)` — unchanged; it now
  rides narrower between the wider left and bigger preview automatically.

No data, API, or logic changes. The middle file list already renders inside a
`Table minWidth="52rem"` horizontal scroll region, so a narrower middle degrades
gracefully rather than clipping content.

## Divider unchanged

The draggable divider from #65 still works: the drag/keyboard handlers,
`clampPreviewWidth`, `--preview-w` var, and the `documents:previewWidth`
localStorage persistence are untouched. Only the starting width changed. Users
who have already dragged the divider keep their saved width (the new default
applies to fresh state only).

## Gate

- `pnpm -r typecheck` — pass
- `pnpm -r lint` — pass

Preview not run: the LAN backend (behind office NAT) isn't reachable from the
build sandbox, and the panes only paint after `/api/*` data loads. Change is two
numeric constants + one Tailwind arbitrary-value class, verified by the gate.
