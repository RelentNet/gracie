# 03 — Project Structure

> Monorepo layout (pnpm workspaces), where shared contracts live, and how Figma's component list maps into the Next.js app.

---

## 1. Monorepo rationale

A single repo with **pnpm workspaces** holds the Next.js app, the Fastify worker, and shared packages. This lets `apps/web` and `apps/worker` import the **same** types, DB client, and AI-provider interface without publishing npm packages. One install, one type-check, one source of truth for contracts.

**Toolchain (verified):** Node 24, pnpm 10.33. Use `pnpm` for all workspace commands.

---

## 2. Top-level tree

```
gracie/
├── apps/
│   ├── web/                  # Next.js (App Router) — UI + light API routes
│   └── worker/               # Fastify + BullMQ — long-running pipeline jobs
├── packages/
│   ├── shared/               # Types, AI-provider interface, constants, zod schemas
│   ├── db/                   # Supabase client, migrations, generated DB types
│   └── config/               # Shared tsconfig, eslint, tailwind preset
├── infra/                    # Coolify/compose, Cloudflare Tunnel, deploy notes
├── docs/                     # This blueprint
├── package.json              # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example              # documented in 07-integrations.md
└── README.md
```

---

## 3. `apps/web` — Next.js frontend + light API

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx                 # Module 10 — Login
│   │   └── callback/route.ts              # Logto callback handler
│   ├── (app)/                             # authenticated shell (sidebar layout)
│   │   ├── layout.tsx                     # Sidebar + role-based nav filtering
│   │   ├── dashboard/page.tsx             # Module 1 — Daily Command Center
│   │   ├── clients/
│   │   │   ├── page.tsx                   # Module 2 — Client List
│   │   │   └── [clientId]/
│   │   │       ├── layout.tsx             # 7-tab nav (role-filtered)
│   │   │       ├── overview/page.tsx      # Tab 1
│   │   │       ├── strategy/page.tsx      # Tab 2
│   │   │       ├── finance/page.tsx       # Tab 3 (Admin only)
│   │   │       ├── operations/page.tsx    # Tab 4
│   │   │       ├── notes/page.tsx         # Tab 5
│   │   │       ├── documents/page.tsx     # Tab 6 (file browser)
│   │   │       └── intelligence/page.tsx  # Tab 7 (AI chat)
│   │   ├── pipeline/page.tsx              # Module 4
│   │   ├── documents/page.tsx            # Module 5 — global file browser
│   │   ├── tasks/page.tsx                # Module 6 — Task Board
│   │   ├── calendar/page.tsx            # Module 7
│   │   ├── daily-sync/page.tsx          # Module 8
│   │   ├── knowledge-base/page.tsx      # Module 9
│   │   ├── upload/page.tsx              # Module 3 — Upload
│   │   └── settings/page.tsx            # Module 12 (Admin only)
│   └── api/                              # light/synchronous endpoints only
│       ├── dashboard/route.ts
│       ├── clients/...
│       ├── files/url/route.ts            # presigned URL issuer
│       ├── files/move/route.ts
│       ├── tasks/...
│       ├── ai/chat/route.ts              # streams from provider interface
│       ├── webhooks/recall/route.ts      # enqueues BullMQ job, returns 202
│       └── ...                           # full map in 05-api-route-map.md
├── components/
│   ├── Sidebar.tsx
│   ├── StatusBadge.tsx                   # shared status badge (see 08)
│   ├── DocumentPill.tsx
│   ├── ClientAvatar.tsx
│   ├── FileBrowser/                      # two-panel browser (client + global)
│   │   ├── FolderTree.tsx
│   │   ├── FileList.tsx
│   │   └── Breadcrumb.tsx
│   ├── client-tabs/                      # one component per client tab
│   ├── tasks/
│   ├── calendar/
│   └── ui/                               # primitives (Button, Card, Badge, Modal)
├── lib/
│   ├── auth.ts                           # Logto helpers, useAuth, role guards
│   ├── api-client.ts                     # typed fetch wrapper
│   └── format.ts                         # Eastern-time formatting, etc.
├── styles/
│   ├── theme.css                         # color tokens, base styles
│   └── fonts.css                         # IBM Plex Sans & Mono
├── public/
├── next.config.ts
└── package.json
```

**Note on API routes vs worker:** `apps/web/app/api/*` handles only fast, synchronous work (reads, presigned URLs, enqueueing). Anything long-running (generation, embedding) is **enqueued** to the worker, never executed inline.

---

## 4. `apps/worker` — Fastify + BullMQ

```
apps/worker/
├── src/
│   ├── index.ts                          # Fastify bootstrap + queue registration
│   ├── queues/
│   │   ├── pipeline.queue.ts             # meeting/upload pipeline jobs
│   │   ├── calendar.queue.ts             # scan / dispatch / watchdog (repeatable)
│   │   ├── daily-sync.queue.ts
│   │   └── brief.queue.ts                # pre-meeting briefs
│   ├── processors/
│   │   ├── pipeline.processor.ts         # the 6-doc generation pipeline
│   │   ├── ingest.processor.ts           # extract → chunk → embed
│   │   ├── calendar-scan.processor.ts    # Graph scan + dedup + match
│   │   ├── bot-dispatch.processor.ts     # Recall.ai dispatch
│   │   ├── transcript-watchdog.processor.ts
│   │   ├── daily-sync.processor.ts
│   │   └── brief.processor.ts
│   ├── steps/                            # individual pipeline steps (testable)
│   │   ├── extractText.ts
│   │   ├── chunk.ts
│   │   ├── embed.ts
│   │   ├── generateDocument.ts
│   │   ├── extractTasks.ts
│   │   └── storeDocument.ts
│   └── lib/
│       ├── recall.ts                     # Recall.ai client
│       ├── graph.ts                      # Microsoft Graph client (app-level)
│       ├── resend.ts                     # email client
│       └── r2.ts                         # R2 client (server-only)
└── package.json
```

---

## 5. `packages/shared` — the contracts everything depends on

```
packages/shared/
├── src/
│   ├── ai/
│   │   ├── provider.ts        # ⭐ universal AI provider INTERFACE (D11)
│   │   ├── openai.adapter.ts  # first implementation
│   │   ├── registry.ts        # selects provider+model from settings
│   │   └── prompts/           # 5-layer prompt templates (see 06)
│   ├── types/
│   │   ├── user.ts            # User, Role
│   │   ├── client.ts
│   │   ├── meeting.ts
│   │   ├── document.ts
│   │   ├── task.ts
│   │   ├── file.ts
│   │   └── ...                # mirror the DB schema (04)
│   ├── schemas/               # zod validators for API request/response
│   ├── constants/
│   │   ├── roles.ts
│   │   ├── enums.ts           # statuses, document types, topics, meeting types
│   │   └── permissions.ts     # the permission matrix as data
│   └── index.ts
└── package.json
```

### ⭐ The AI provider interface (the most important contract)

All AI usage goes through this interface — **never** an SDK directly. Adding Claude later = a new adapter, zero changes at call sites.

```ts
// packages/shared/src/ai/provider.ts  (illustrative — not production code)

export interface AIProvider {
  readonly id: string;            // 'openai' | 'anthropic' | ...
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  embed(input: EmbedInput): Promise<number[][]>;   // embeddings PINNED (D9)
}

export interface GenerateInput {
  model: string;                  // selected in Settings
  system: string;                 // assembled 5-layer prompt (system portion)
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  responseFormat?: 'text' | 'json';   // task extraction uses 'json'
}
```

- **Generation/stream:** provider + model are switchable (Settings dropdown + per-provider key).
- **Embeddings:** pinned to `text-embedding-3-small` for index coherence (D9). The `embed` method exists on the interface, but the registry always routes it to the pinned model regardless of the selected generation provider.

---

## 6. `packages/db` — database access

```
packages/db/
├── migrations/
│   └── 0001_init.sql          # generated from docs/04-database-schema.sql
├── src/
│   ├── client.ts              # Supabase server client (service role, backend-only)
│   ├── client.browser.ts      # anon client (RLS-bound, frontend-safe)
│   └── types.ts               # generated DB types (supabase gen types)
└── package.json
```

**Two clients, deliberately:** a service-role client for the worker/backend (bypasses RLS, used for trusted server logic) and an anon/RLS-bound client for any frontend-side reads. Never ship the service-role key to the browser.

---

## 7. `infra/` — deployment

```
infra/
├── coolify/                   # service definitions / compose for each container
├── cloudflare/                # Tunnel config notes
├── env/                       # per-env .env templates (not secrets)
└── README.md                  # deploy + bootstrap runbook
```

---

## 8. Figma component → code mapping

| Figma component | Lives at |
| --- | --- |
| `Sidebar.tsx` | `apps/web/components/Sidebar.tsx` |
| `Dashboard.tsx` | `app/(app)/dashboard/page.tsx` |
| `Login.tsx` | `app/(auth)/login/page.tsx` |
| `ClientsList.tsx` | `app/(app)/clients/page.tsx` |
| `ClientDetail.tsx` (+ 7 tabs) | `app/(app)/clients/[clientId]/*` + `components/client-tabs/*` |
| `DocumentViewer.tsx` (global browser) | `app/(app)/documents/page.tsx` + `components/FileBrowser/*` |
| `CalendarView.tsx` | `app/(app)/calendar/page.tsx` |
| `TaskBoard.tsx` | `app/(app)/tasks/page.tsx` |
| `PipelineMonitor.tsx` | `app/(app)/pipeline/page.tsx` |
| `KnowledgeBase.tsx` | `app/(app)/knowledge-base/page.tsx` |
| `AdminSettings.tsx` | `app/(app)/settings/page.tsx` |
| `TranscriptUpload.tsx` | `app/(app)/upload/page.tsx` |
| `DailySync.tsx` | `app/(app)/daily-sync/page.tsx` |
| `PreMeetingBrief.tsx` | `components/calendar/PreMeetingBrief.tsx` |
| `MasterRecord.tsx` | `components/client-tabs/MasterRecord.tsx` (Strategy tab) |
| `StatusBadge.tsx` / `DocumentPill.tsx` / `ClientAvatar.tsx` | `apps/web/components/*` (shared primitives) |
| `AuthContext.tsx` | `apps/web/lib/auth.ts` (provider + hooks) |

---

## 9. Naming & convention reminders (from global standards)

- Components: `PascalCase.tsx`; hooks: `useThing.ts`; utilities: `camelCase.ts`.
- Booleans: `is/has/should` prefix. Constants: `UPPER_SNAKE_CASE`.
- `interface` for object shapes; explicit return types on exported functions; no `any`.
- Import order: framework → third-party → `@/` internal → relative → `import type`.
- Every component ships **loading, error, and empty** states. No placeholder/Lorem content.
- Path aliases over deep relative imports.
