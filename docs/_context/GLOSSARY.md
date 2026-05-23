# GA App — Glossary

> Project-specific terms. If a new term appears in a session and isn't here, add it.

---

**Allie** — Allie Grace, principal of Grace & Associates. Primary user / customer / final decision-maker.

**Bot dispatch** — Sending a Recall.ai bot to a video meeting URL ≤5 min before start. One bot per meeting record regardless of how many team members are invited.

**Cadence** — The expected meeting frequency per client. Enum: `weekly` / `biweekly` / `monthly` / `qbr`.

**canEdit** — Frontend helper that returns true for Admin and Standard roles only. Used to hide/show UI affordances. **Never** the security boundary — server enforces.

**Client-facing document** — Any document where `requires_review = true`. Currently: Client Summary and Client Email Draft. Hard rule: never auto-send.

**Daily Sync** — Auto-generated daily briefing. One per day. Cron at 5:45 AM ET generates, 6:00 AM ET delivers via Resend to all team. Page exists in-app too (`/daily-sync`); Yesterday tab visible until midnight (per Figma) / 48 hours (per v1) — defer until plan-writing.

**Eastern time / ET** — All timestamps displayed and stored in Eastern. Locked.

**Fee tier** — Per-client classification: `low` / `mid` / `high`. **Admin-only** field. Affects task prioritization in dashboards (Admin sees the weighting).

**Figma-only feature** — A feature present in the Figma frontend spec but not in the v1 backend spec. Each one is enumerated in STATE.md "Reconciliation conflicts" and explicitly accepted or deferred.

**Generated documents (the 6)** — Outputs of the AI pipeline per meeting:
1. Post-Meeting Analysis (internal)
2. Internal Memo (internal)
3. Client-Facing Summary (`requires_review = true`)
4. Task Checklist (structured JSON → tasks table)
5. Internal Email Draft (stored, retrieved manually)
6. Client Email Draft (`requires_review = true`)

**has_open_items** — Boolean on a meeting record. True if tasks were extracted and any are still `open` or `in_progress`. Used to pull historical context into future pipeline runs.

**Intelligence tab** — Per-client Claude chat interface. RAG over that client's pgvector chunks. Optional Knowledge Base context. Figma adds an "Online Research" toggle (status: open).

**Knowledge Base (KB)** — Global landscape documents (VA policy, CMS guidance, etc.). Available as additional context in all Intelligence tab queries when toggle on. Has topic tags and optional expiration dates.

**MASTER_RECORD** — Chronological per-client log of meeting summaries. One entry per meeting. Surfaced on Strategy tab; Figma additionally implies a full-page view.

**Meeting lead** — The team member primarily responsible for a client meeting. Pipeline alerts (e.g., no transcript within 90 min) go to this person.

**Pipeline** — The end-to-end flow that turns a Recall transcript or upload into 6 documents + extracted tasks + MASTER_RECORD entry + notifications.

**Pre-Meeting Brief** — Auto-generated brief delivered N days (default config) before an upcoming meeting. Stored in R2 under `clients/[slug]/pre-meeting/`.

**Presigned URL** — Temporary (15-min) signed URL minted by the backend after a role check. The only way the frontend touches R2. **Frontend never holds R2 credentials.**

**Recall.ai** — The meeting bot vendor. Joins video meetings, records, returns transcript via webhook. v1 spec explicitly chose this over Otter.ai and tldv.

**requires_review** — Boolean on documents. True for Client Summary + Client Email Draft. Blocks Send / Stage actions in the UI; also enforced server-side.

**Restricted folder** — A folder with `visibility = restricted`. Standard and Viewer roles **do not see it at all** (not just locked — absent from their view).

**Role middleware** — Server-side check on every API route that verifies role from validated Logto JWT claims. UI hiding is presentation, not security.

**Three roles** — `admin` / `standard` / `viewer`. Assigned at the Logto level; mirrored to `users.role` in Supabase on first login.
