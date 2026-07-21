# Delegation Brief — Documents: "Mark reviewed" (clear the needs-review flag)

> Self-contained brief for a fresh Claude Code session. Read §0 + §4 first.
> **Platform:** macOS, Node 24, pnpm. Web only (`apps/web`). **No worker, no migration expected.**
> **Branch + PR. Do NOT push to `main`.** Small, self-contained — the operator is actively blocked by this.

---

## 0. The problem (operator-reported live 2026-07-21)
Every generated meeting emits two **client-facing** drafts — `client_email.md` (`client_email_draft`) and `client_summary.md` (`client_summary`) — deliberately flagged `status = 'needs_review'` so a human vets them before anything reaches a client. That flagging is **correct and by design** (P5b `requires_review`).

**The hole: nothing can ever clear the flag.** Verified in code:
- `PATCH /api/documents/[id]` (added by #47) accepts **only** `fileName`, `visibility`, `allowedRoles` — the patch object is literally typed `{ fileName?, visibility?, allowedRoles? }`. **No `status`.**
- The only writers of `needs_review` are the generate pipeline and the upload modal's "Requires Review" option (`apps/web/app/api/upload/route.ts`, `components/FileBrowser/UploadModal.tsx`).
- **No code path anywhere sets a document back to `ready`.**

So the badge is write-only. The operator sees "needs review" with no way to review, clear, or act on it. **17 documents are stuck today, growing by +2 for every meeting recorded** — and now that auto-generation actually works (#46), that counter accelerates.

*(History: this was cut in #5 when the visual-only "…" row menu was removed; rename/delete/mark-reviewed were deferred. #47 came back and built rename + permissions + delete — but not mark-reviewed.)*

## 1. Build
All the plumbing #47 added is reusable — this should be a small change.

- **API:** extend `PATCH /api/documents/[id]` to accept a review state (e.g. `status: 'ready' | 'needs_review'`, or a clearer `reviewed: boolean` — pick one and keep it explicit). Extend `updateDocument` in `apps/web/lib/data/documents.ts` to persist it. Validate strictly; ignore unknown values.
- **UI:** add a **"Mark reviewed"** item to the row-action menu that #47 already built in the Documents file list. Show it **only** when the document is currently `needs_review`. Include the inverse ("Mark as needs review") so a staffer can flag something back — but never present both at once.
- **Backlog:** provide a way to clear the existing 17 without 17 individual clicks — either multi-select + "Mark reviewed", or a "Mark all reviewed" on a filtered needs-review view. Keep it obvious and safe (confirm once, no destructive adjacency).
- **Visibility:** make needs-review documents easy to *find* — at minimum the existing status badge, ideally a filter/quick-view so someone can answer "what's waiting on me?" without hunting through folders.
- **Permission:** the PATCH route currently gates on `folder.manage` (editor tier). Reviewing a client-facing draft is an editorial act, so editor is the right default — but see §4: don't over-gate this to admin-only.

## 2. Explicitly OUT of scope
- No changes to *what* gets flagged (the pipeline's `requires_review` behaviour stays exactly as-is).
- No document content editing, no approval workflow, no send-to-client action. This is purely clearing/setting a review flag.
- Don't touch the recycle-bin, permissions, or rename logic #47 shipped.

## 3. Gate
- Green gate: `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`.
- Verify with the preview tools against real data as more than one role: a `needs_review` doc can be marked reviewed by an editor, the badge clears, it persists on reload, and a **viewer cannot** do it.
- No migration expected (`documents.status` already exists with the `needs_review` / `ready` enum values). If you think you need one, stop and flag it.
- No secrets staged; scope commits to explicit paths.

## 4. ⭐ Standing operability constraint (governs this feature)
At handover the only actors are **the AI and non-technical GA staff** — no engineer, no Claude. This feature is a direct test of that bar:
- The action must be **one obvious button** with a plain label ("Mark reviewed"), not a status dropdown that requires knowing the enum.
- A staffer must be able to answer *"what needs my review?"* and clear it **entirely from the dashboard**, with no context.
- **Don't over-gate it.** If review is admin-only and no admin is around, the queue silently grows forever. Editor tier is the recommended default; only restrict further if there's a real reason.
- **Acceptance test:** *could a new GA staff member, with no context and no engineer, find the documents waiting on them and clear them from the dashboard?* If no, it isn't done.
