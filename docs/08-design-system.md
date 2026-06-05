# 08 — Design System & UI/UX (Figma source of truth)

> The Figma Spec is authoritative for look, layout, and component behavior.
> Tech: React (in Next.js App Router), TypeScript, Tailwind CSS v4, Lucide React icons.

---

## 1. Aesthetic & principles

- **Compact data density** — power-user internal tool, not a marketing site.
- **Professional federal-consulting** visual language.
- **Admin-only fields** marked with a red left border or a 🔒 lock icon.
- **Restricted content is completely hidden** from unauthorized users (not just locked).
- All timestamps render in **Eastern time**.
- **No auto-send** of client-facing documents — ever.
- Auth via **Logto + Microsoft SSO** only.

---

## 2. Color tokens

| Token | Hex | Usage |
| --- | --- | --- |
| Navy | `#0f172a`, `#1e293b` | Sidebar bg, primary dark text |
| Blue | `#3b82f6`, `#1e40af`, `#dbeafe` | Primary actions, links, in-progress |
| Emerald | `#10b981`, `#059669`, `#d1fae5` | Success, complete, positive |
| Amber | `#f59e0b`, `#d97706`, `#fef3c7` | Warnings, 48h flags, needs-review |
| Red | `#ef4444`, `#dc2626`, `#fee2e2` | Overdue, critical, admin-only |
| Slate | `#64748b`, `#475569`, `#f1f5f9` | Secondary text, inactive, backgrounds |

Define as CSS custom properties in `styles/theme.css` and as a Tailwind v4 theme.

---

## 3. Typography

- **Headings:** IBM Plex Sans, weights 600–700.
- **Body:** IBM Plex Sans, weights 400–500.
- **Code/Data:** IBM Plex Mono, weights 400–500.
- **Convention:** font-size / weight / line-height applied via **inline styles**, not
  Tailwind text classes (per Figma spec). Imports in `styles/fonts.css`.

| Element | Size | Weight |
| --- | --- | --- |
| Page titles | 2rem (32px) | 600 |
| Section headers | 1.25–1.5rem | 600 |
| Body | 0.9375rem (15px) | 400–500 |
| Secondary | 0.8125–0.875rem | 400 |
| Labels | 0.75rem (12px) uppercase, letter-spacing 0.05em | 600 |

---

## 4. Spacing, radius, shadow

- **Spacing:** compact — `p-3/p-4`, `gap-2/gap-3`. Card padding `p-6`. Section `p-8`. Icons 14–20px.
- **Radius:** cards/buttons `rounded-lg` (8px); badges/pills `rounded-md` (6px); avatars `rounded-full`.
- **Shadow:** cards `shadow-sm`; modals `shadow-xl`; buttons `shadow-sm` (hover `shadow-md`).

---

## 5. Shared components

### StatusBadge
Props: `status` (`scheduled | processing | complete | needs-review | overdue`), `size` (`sm | md | lg`).

| Status | Bg / text |
| --- | --- |
| Scheduled | Amber bg / dark amber |
| Processing | Blue bg / dark blue |
| Complete | Emerald bg / dark emerald |
| Needs Review | Amber bg / dark amber |
| Overdue | Red bg / dark red |

### DocumentPill
Props: `type` (`analysis | memo | summary | checklist | email`). Colored pill + icon.

### ClientAvatar
Props: `initials`, `size`, `color?`. Circular avatar with initials.

### Priority badge
`HIGH` red · `MEDIUM` amber · `LOW` blue.

### Type badges (files)
Meeting (blue) · Upload (purple) · Auto (emerald).

### File status badges
Ready (emerald) · Requires Review (amber) · Delivered (blue).

**Every component ships loading / error / empty states. No placeholder/Lorem content.**

---

## 6. Navigation (sidebar)

1. Overview · 2. Clients · 3. Pipeline · 4. Documents · 5. Task Board ·
6. Calendar · 7. Daily Sync · 8. Knowledge Base · 9. Settings (Admin only).

**Bottom section:** avatar (initials), name, role badge (Admin = navy, Viewer = amber, Standard = none), calendar connection dot (green), Sign Out.

Nav items filtered by role (Settings hidden for non-admin).

---

## 7. Role-visibility UX rules

| Role | Badge | Hidden entirely | Actions |
| --- | --- | --- | --- |
| Admin | Navy "Admin" | nothing | all |
| Standard | none | Finance tab, Transcripts folder, Settings | all except restricted |
| Viewer | Amber "Viewer" | same as Standard | read-only; only "Mark Complete" on own tasks |

Restricted items are **absent** from the DOM for unauthorized roles, mirroring the
server omission — not merely disabled.

---

## 8. Modules (UI behavior summary)

- **M1 Dashboard:** "Daily Command Center", date, Upload (hidden for Viewer), Daily Sync banner, KB-expiry amber alert, 3 metric cards, two columns (Meeting Pipeline / Priority Tasks), needs-attention red alert cards. Auto-refresh 60s.
- **M2 Clients:** grid of client cards (avatar, name, contract, fee tier dot [Admin], cadence, health score colored, last meeting). Click → profile.
- **M2A Client Profile:** header + 7 tabs (Overview, Strategy, Finance[Admin], Operations, Notes, Documents, Intelligence). Tabs renamable/reorderable by Admin.
- **M3 Upload:** client dropdown, multi-file + context/output prompts, type/meeting-type selectors, "Process".
- **M4 Pipeline:** meeting table w/ live status badges; Weekly / History / Error(Admin) tabs; manual trigger.
- **M5 Documents (global):** two-panel browser; filters; inline preview ([VERIFY] amber); Stage-as-Draft.
- **M6 Task Board:** cross-client table; overdue red / 48h amber rows; filters; archive; Viewer mark-own-complete only.
- **M7 Calendar:** month grid + day detail sidebar; connection status panel; ambiguous-assignment list (Admin); cadence + brief trackers.
- **M8 Daily Sync:** today's briefing; Yesterday tab; generated 6:00 AM ET.
- **M9 Knowledge Base:** table (title, topic chips, type, uploaded, status, expiry badges); filters; upload modal (title, file, tags, description, expiration, AI toggle).
- **M10 Login:** centered card, GA wordmark, "Sign in with Microsoft", dark navy gradient; first-login "Setting up your account…".
- **M11 File Browser:** two-panel (folder tree / file list), breadcrumb; default folders Generated/Uploads/Pre-Meeting/Transcripts(🔒 Admin); folder + file actions per role.
- **M12 Settings (Admin):** Company Settings, Calendar & Automation, Integrations + **API Settings** (below), User Management.

---

## 9. The 7 client-profile tabs

1. **Overview** — health score (emerald gradient), last meeting snapshot, top-3 open tasks, editable description, Drive quick-link.
2. **Strategy** — trajectory indicator, meeting-frequency trend, risk flags (red), MASTER_RECORD chronology, admin notes.
3. **Finance (Admin only)** — fee tier, contract value (🔒), billing cadence (🔒), task completion rate, time vs revenue. Tab hidden from others.
4. **Operations** — client-scoped task table, pipeline run history, transcript history (source badges).
5. **Notes** — compose area + chronological feed (author chip + timestamp); edit/delete own.
6. **Documents** — two-panel file browser (M11), Transcripts folder Admin-only.
7. **Intelligence** — scope bar ("Scoped to [Client]"), Online Research toggle, chat (Claude/AI left in slate-100, user right in blue-600, markdown bold), textarea + Send, "Enter to send / Shift+Enter newline".

---

## 10. Admin → API Settings page ⭐ NEW

Lives under **Settings → API Settings** (Admin only). Backs `integration_credentials`
+ AI provider selection (see `05-api-route-map.md`).

**Layout:** a card per integration.

| Card | Fields | Actions |
| --- | --- | --- |
| Recall.ai | API key (masked), region | Save · Test Connection · Remove |
| AI Provider | Provider dropdown (OpenAI now; Anthropic later), Model dropdown, API key (masked) | Save · Test · Set Active |
| OpenAI (embeddings) | Status only — **pinned**, not switchable | (read-only note) |
| Resend | API key (masked), From address | Save · Test |
| Cloudflare R2 | Access key id, secret (masked), bucket, endpoint | Save · Test |
| Microsoft Graph | Tenant/client id, secret (masked), group id | Save · Test |
| Supabase | Status only (bootstrap, env) | (read-only) |
| Logto | Status only (bootstrap, env) | (read-only) |

**UX rules:**
- Secrets are **write-only** from the UI — show masked `••••• set` + last-4 if needed, never the full value (API never returns it).
- Each card shows status: `Not set` / `Set` + last test result (green check / red x) + timestamp.
- "Test Connection" calls `POST /api/settings/integrations/:service/test`.
- Changing the active AI provider/model is instant (next request uses it). Embeddings card is explicitly read-only with a note: "Embeddings are pinned to text-embedding-3-small for index consistency."
- Page is **completely hidden** from non-admins (route + nav).

---

## 11. Accessibility (WCAG 2.2 AA target)

- Semantic HTML first (`<button>` for actions, `<a>` for nav); ARIA only to supplement.
- Keyboard navigation + visible focus indicators on all interactive elements.
- Status conveyed by **icon + text**, not color alone.
- `alt` text on images; `aria-label` only where semantic HTML is insufficient.
- Contrast ratios meet AA.
