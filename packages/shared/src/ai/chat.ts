/**
 * Intelligence chat (Tab 7) — pure retrieval-filtering + prompt assembly (docs/06 §7).
 *
 * CLIENT-SAFE and DB-FREE on purpose: this module holds the SECURITY-CRITICAL
 * role filter and the chat-specific prompt assembly as pure, total functions so
 * they can be unit-tested and reused. The DB work (embed query, `match_embeddings`,
 * `match_kb_embeddings`) lives in the API route; the role gate lives HERE.
 *
 * Why a chat-specific assembly instead of the doc-generation `assemblePrompt`
 * (docs/06 §2): doc generation is single-turn (one source document → one
 * system+user pair); chat is multi-turn (a growing message history) and injects
 * RETRIEVED chunks as grounding rather than a single source document. Sharing
 * `assemblePrompt` would distort both, so this mirrors only its `section()` shape.
 */
import type { EmbeddingSource } from '../constants/enums.js';
import type { AIMessage } from './provider.js';

/** One chunk returned from vector retrieval, before/after role filtering. */
export interface RetrievedChunk {
  readonly id: string;
  readonly sourceType: EmbeddingSource;
  readonly sourceId: string;
  readonly content: string;
  /** Cosine similarity in [0, 1] (1 = identical) as returned by the RPC. */
  readonly similarity: number;
}

/**
 * SECURITY: source types a non-admin must NEVER receive as chat grounding.
 * Transcripts live in `restricted`-visibility folders (Admin-only, D14); their
 * embeddings must be filtered out of retrieval for Standard/Viewer exactly as the
 * file browser omits the Transcripts folder (lib/data/documents.ts
 * `isVisibleToRole`). Extend this set if any future `source_type` becomes
 * Admin-only.
 */
export const ADMIN_ONLY_SOURCE_TYPES: readonly EmbeddingSource[] = ['transcript'];

/**
 * SECURITY-CRITICAL. Drop chunks whose `sourceType` is Admin-only when the
 * requester is not an admin. Admins receive every chunk; non-admins never receive
 * a transcript-sourced chunk. Apply this to the CLIENT retrieval results BEFORE
 * trimming to top-K and BEFORE any chunk reaches the prompt. Pure + total.
 */
export function filterChunksForRole(
  chunks: readonly RetrievedChunk[],
  isAdmin: boolean,
): RetrievedChunk[] {
  if (isAdmin) return [...chunks];
  return chunks.filter((chunk) => !ADMIN_ONLY_SOURCE_TYPES.includes(chunk.sourceType));
}

export interface ChatPromptInput {
  /** Layer 1 — settings.ga_company_description. */
  readonly gaCompanyDescription: string;
  /** Layer 2 — clients.description (the scoped client). */
  readonly clientDescription: string;
  /** Display name of the scoped client (for the system instruction). */
  readonly clientName: string;
  /** Role-filtered, top-K chunks from THIS client's documents. */
  readonly clientChunks: readonly RetrievedChunk[];
  /** Knowledge Base chunks (global, `ai_active`) — empty unless the KB toggle is on. */
  readonly knowledgeBaseChunks: readonly RetrievedChunk[];
  /** Recent prior turns (oldest→newest), excluding the new user message. */
  readonly history: readonly AIMessage[];
  /** The new user message. */
  readonly message: string;
}

export interface AssembledChatPrompt {
  readonly system: string;
  readonly messages: readonly AIMessage[];
}

/** Max prior turns kept in the prompt; older turns are dropped (recent history). */
export const CHAT_HISTORY_LIMIT = 10;

const VERIFY_RULE =
  'When any statement is uncertain, inferred, or not directly supported by the context below, wrap it in [VERIFY: ...] so a human can confirm it. Never present speculation as fact.';

const TONE_RULE =
  'Write in a polished, professional federal healthcare-consulting tone. Be precise and concise; avoid filler.';

const GROUNDING_RULE =
  'Answer using the retrieved context below and the conversation so far. If the context does not contain the answer, say so plainly rather than inventing details. Respond in Markdown (use **bold** for emphasis).';

function section(title: string, body: string): string {
  const content = body.trim() === '' ? '(none provided)' : body.trim();
  return `## ${title}\n${content}`;
}

/** Render chunks as a numbered list, collapsing internal whitespace. */
function renderChunks(chunks: readonly RetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => `${index + 1}. ${chunk.content.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
}

/**
 * Assemble the chat system prompt + message array. The system prompt layers GA
 * context, client context, the role-filtered retrieved chunks, and the optional
 * Knowledge Base chunks; the messages are recent history + the new user turn.
 */
export function assembleChatPrompt(input: ChatPromptInput): AssembledChatPrompt {
  const sections = [
    section('About Grace & Associates', input.gaCompanyDescription),
    section(`About the Client (${input.clientName})`, input.clientDescription),
    section('Retrieved Context — Client Documents', renderChunks(input.clientChunks)),
  ];
  if (input.knowledgeBaseChunks.length > 0) {
    sections.push(
      section('Retrieved Context — Knowledge Base', renderChunks(input.knowledgeBaseChunks)),
    );
  }
  sections.push(section('Rules', [GROUNDING_RULE, VERIFY_RULE, TONE_RULE].join('\n')));

  const recentHistory = input.history.slice(-CHAT_HISTORY_LIMIT);
  return {
    system: sections.join('\n\n'),
    messages: [...recentHistory, { role: 'user', content: input.message }],
  };
}
