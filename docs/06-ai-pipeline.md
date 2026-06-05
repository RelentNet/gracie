# 06 — AI Pipeline & Provider Abstraction

> The document-generation pipeline, the 5-layer prompt chain, task extraction,
> and the universal AI-provider interface (OpenAI first, switchable later).

---

## 1. Universal AI provider abstraction (D11)

**Rule:** No code calls an AI SDK directly. Everything goes through one interface
in `packages/shared/src/ai/provider.ts`. Adding a provider later = a new adapter +
a key in Admin → API Settings. Zero call-site changes.

```ts
export interface AIProvider {
  readonly id: string;                 // 'openai' | 'anthropic' | ...
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  embed(input: EmbedInput): Promise<number[][]>;
}
```

- **generate / stream** — provider + model come from `settings.ai_provider` /
  `settings.ai_model` (set in API Settings). Used by the pipeline and the
  Intelligence chat.
- **embed** — the registry ALWAYS routes embeddings to the pinned model
  `text-embedding-3-small` (1536-dim) regardless of the selected generation
  provider, to keep the pgvector index coherent (D9).

### Registry / selection
```
getProvider():          // for generation
  read settings.ai_provider + ai_model
  → load adapter from registry
  → inject decrypted key via getCredential(service)  (see 05 API Settings)

getEmbedder():          // for embeddings — PINNED
  always OpenAI text-embedding-3-small
```

If a provider's key is missing/invalid, the call fails loudly and the pipeline
marks the run `needs_attention` with a clear error (Admin sees it in error logs).

---

## 2. The 5-layer prompt chain (always this exact order)

Every generation assembles context in this sequence:

```
1. GA company description        (settings.ga_company_description)
2. Client description            (clients.description)
3. Document type / meeting type  (what we're generating)
4. Consultant context            (per-file notes from upload, or meeting notes)
5. Historical context            (top-5 recent meeting summaries from pgvector
                                  + any meetings where has_open_items = true)
6. Source content                (transcript text or uploaded file content)
```

Layers 1–5 form the **system** portion; layer 6 is the user content. Templates live
in `packages/shared/src/ai/prompts/`.

### Global prompt rules (enforced in the system prompt)
- Wrap any uncertain/inferred/possibly-hallucinated content in **`[VERIFY: ...]`**
  tags. The UI renders these in amber for human review.
- Client-facing outputs must read as polished, professional, federal-consulting tone.
- Task extraction must return **structured JSON** (schema below), always.

---

## 3. The 6 generated document types

| # | Document | Audience | `requires_review` | Notes |
| --- | --- | --- | --- | --- |
| 1 | Post-Meeting Analysis | Internal | false | Deep internal read of the meeting |
| 2 | Internal Memo | Internal | false | Team-facing summary |
| 3 | Client-Facing Summary | Client | **true** | Never auto-sent; staged for review |
| 4 | Task Checklist | Internal | false | Parsed → `tasks` table |
| 5 | Internal Email Draft | Internal | false | Stored; team retrieves manually |
| 6 | Client Email Draft | Client | **true** | Never auto-sent; "Stage as Draft" → Outlook draft |

**No-auto-send rule (absolute):** documents 3 and 6 are never sent automatically.
They are produced, flagged `requires_review`, and a human must explicitly approve.
"Stage as Draft" creates an Outlook draft via Graph with recipients pre-filled — it
does not send.

---

## 4. Automatic meeting pipeline (Recall.ai webhook)

```
Recall.ai webhook: meeting ended, transcript ready
  ↓
Verify meeting record exists AND bot_job_id matches  (else reject)
  ↓
Store raw transcript in R2:
  clients/[client-slug]/transcripts/[YYYY-MM-DD].txt      (Admin-only folder)
  ↓
Extract text → chunk → embed → embeddings table
  (source_type = 'transcript', client_id set)
  ↓
Retrieve historical context:
  - top-5 recent meeting summaries (pgvector, client-scoped)
  - tasks where status != complete (open items context)
  ↓
Generate 6 documents via provider interface — SEQUENTIAL (D7):
  analysis → memo → client-summary → task-checklist → internal-email → client-email
  (docs 3 & 6 → requires_review = true)
  ↓
Store each doc in R2:
  clients/[client-slug]/generated/[YYYY-MM-DD]/<doc>.docx
  ↓
Insert documents rows (source_badge = 'meeting')
  ↓
Parse Task Checklist → structured tasks → insert into tasks table
  ↓
If tasks found → set meetings.has_open_items = true
  ↓
Append master_record_entries summary for the client
  ↓
Update pipeline_runs (status, duration, documents_generated)
  ↓
meetings.pipeline_status = 'complete'
  ↓
Notify attendees (in-app): "Documents ready for [Client] — [Date]"
```

Each step updates `meetings.pipeline_status` so the frontend poll reflects progress:
`processing` → … → `complete` (or `needs_attention` on failure).

---

## 5. Manual upload pipeline (upload form)

```
File received → store in R2:
  clients/[client-slug]/uploads/[YYYY-MM-DD]/<file>
  ↓
Insert documents row (source_badge = 'upload')
  ↓
Extract text by type (D8):
  .docx→mammoth · .pdf→pdf-parse · .csv→papaparse · .txt→native
  (.mp3/.mp4 → Phase 2 / Whisper)
  ↓
Chunk → embed → embeddings (source_type = 'upload')
  ↓
Determine output set from documentType label + outputPrompt:
  e.g. "summarize only" → summary; "extract tasks" → checklist;
       transcript upload → full 6-doc set
  ↓
Generate the appropriate subset via provider interface (sequential)
  ↓
Extract tasks if applicable → tasks table
  ↓
Confirm to user + link to generated documents
```

---

## 6. Task extraction contract (structured JSON, always)

The Task Checklist generation step requests JSON (`responseFormat: 'json'`) and
validates against this shape before writing to `tasks`:

```json
{
  "tasks": [
    {
      "description": "string (imperative, specific)",
      "owner_hint": "string | null",     // name/role mentioned; resolved to user if matchable
      "due_hint": "string | null",        // natural-language due; parsed to date if possible
      "priority": false                   // boolean priority_flag
    }
  ]
}
```

- `owner_hint` is resolved to `owner_user_id` by matching against `users` (name/email);
  unmatched → left null for manual assignment.
- `due_hint` parsed to a date when unambiguous; else null.
- Each task links back via `source_meeting_id` / `source_document_id`.

---

## 7. Intelligence chat (Tab 7) retrieval flow

```
User message (+ clientId, includeKnowledgeBase)
  ↓
Embed query (pinned embedder)
  ↓
match_embeddings(query, clientId, K)         // client-scoped
  + if includeKnowledgeBase: also retrieve KB chunks (ai_active = true)
  ↓
Assemble prompt: GA desc + client desc + retrieved chunks + chat history
  ↓
provider.stream(...)  → stream tokens to UI
```

- Role-filtered: a Viewer/Standard never receives chunks sourced from restricted
  content (e.g. transcripts) they couldn't otherwise see. Enforced at retrieval.
- Markdown (incl. **bold**) rendered in responses.

---

## 8. Failure handling

| Failure | Behavior |
| --- | --- |
| AI call error (rate limit / key) | Retry w/ backoff (BullMQ). After N retries → `needs_attention` + Resend alert to meeting lead. Error in `pipeline_runs.error_message` (Admin-only view). |
| No transcript within 90 min | Watchdog sets `needs_attention` + alert; lead can dismiss or upload manually. |
| Text extraction fails | Mark document `needs_review`, log, continue other docs if possible (`partial`). |
| Task JSON invalid | One re-ask with stricter instruction; if still invalid, store checklist doc but skip task insert + flag. |
| Provider key missing | Fail fast, clear Admin-facing message pointing to API Settings. |

---

## 9. Why sequential + queued (recap)

- **Queued** (BullMQ): generation is 60s+; HTTP must not block. Enqueue → 202 → poll.
- **Sequential**: avoids 6 concurrent provider calls (rate limits), makes per-step
  retry and debugging tractable. Revisit parallelism only if latency becomes a real
  complaint.
