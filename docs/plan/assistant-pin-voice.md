# Assistant: pin chats + voice-to-text input

Two additive Assistant enhancements from the Aug 21 review. Both keep the
existing chat send path untouched.

## 1. Pin chats

A per-conversation pin control in the sidebar. Pinned chats sort to the **top**
of the list, then by recency; unpinned chats follow, also by recency.

- **DB** — `assistant_chats.pinned boolean not null default false`
  (`packages/db/migrations/0022_assistant_chats_pinned.sql`, additive +
  idempotent `IF NOT EXISTS`). `packages/db/src/database.types.ts` hand-updated
  (Row/Insert/Update). **Apply in coordination with the orchestrator** (shared
  dev+prod Supabase — same handling as 0015/0016/0017); every existing row
  backfills to unpinned at ALTER time.
- **Data** (`apps/web/lib/data/assistant.ts`) — `AssistantChatView.pinned`;
  `listChats` orders `pinned desc, updated_at desc`; `updateChat` accepts
  `pinned`. Pinning is metadata, **not** activity: only a title/archive change
  bumps `updated_at`, so unpinning returns a chat to its true recency slot.
- **API** (`app/api/assistant/chats/[id]/route.ts`) — `PATCH` accepts a
  `pinned` boolean (own-only, unchanged auth/ownership gate).
- **UI** (`assistant/ConversationList.tsx`, `assistant/page.tsx`) — a leading
  pin toggle per row: always visible + accent-filled when pinned, hover-only
  when not. `handlePin` PATCHes then re-lists to get server ordering.

## 2. Audio-to-text input (Web Speech API)

A mic button in the composer that transcribes speech **directly into the input
box**, client-side only.

- `apps/web/components/chat/MicButton.tsx` — uses
  `window.SpeechRecognition || window.webkitSpeechRecognition`. **No audio is
  uploaded** — this deliberately avoids the edge-proxy body-size issue and needs
  **no server change**. Recognized final utterances are handed back via
  `onTranscript`; the page appends them to the existing `input` state.
- Listening indicator: the mic pulses red + a "Listening…" `role="status"`
  label while active.
- Unsupported browsers (e.g. Firefox) get a disabled mic with an explanatory
  tooltip — feature-detected on the client (window is undefined during SSR).
- Wired into the Assistant composer's existing `leading` slot beside the attach
  button; the shared `ChatComposer` and Intelligence tab are untouched.

## Scope

Ships the pin + voice-**input** primitives. Full per-client voice logging +
activity reports is the follow-on (not in this PR).

## Verification

`pnpm -r typecheck` ✓ · `pnpm -r lint` ✓ · web tests 68/68 ✓ · worker tests
232/232 ✓. No new dependencies.
