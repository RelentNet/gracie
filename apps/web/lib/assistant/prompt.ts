/**
 * Prompt assembly for the general Assistant (P6B). Unlike the client Intelligence
 * chat, the Assistant has NO client/KB retrieval and NO embeddings — attached
 * files are extracted on upload and their text is injected directly into the
 * turn (chunk + truncate if oversized, per spec §3).
 */
import type { AIProvider, AIMessage } from '@gracie/shared';

/** General-assistant persona (docs §1: native to Gracie, replaces ChatGPT seats). */
export const ASSISTANT_SYSTEM_PROMPT = [
  'You are the Grace & Associates internal AI assistant — a general-purpose helper',
  'for the team’s everyday work: writing and drafting, research and Q&A, and',
  'answering questions about files they attach. Be accurate, concise, and genuinely',
  'helpful. Format answers in Markdown. You do not have live web browsing, so if a',
  'question needs current information you cannot verify, say so plainly rather than',
  'guessing. When the user attaches files, ground your answer in their contents.',
].join(' ');

/** Total character budget for injected attachment text (~6k tokens). */
const MAX_ATTACHMENT_CONTEXT_CHARS = 24_000;

/** Rough token estimate (~4 chars/token) — used for cost tracking, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the injected context block for this turn's attachments. The per-file
 * budget is an even split of the total cap so one large file can't crowd out the
 * others; truncation is flagged inline so the model knows the text is partial.
 */
export function buildAttachmentContext(
  files: ReadonlyArray<{ readonly fileName: string; readonly extractedText: string }>,
): string {
  if (files.length === 0) return '';
  const perFile = Math.floor(MAX_ATTACHMENT_CONTEXT_CHARS / files.length);
  const blocks = files.map((file) => {
    const text =
      file.extractedText.length > perFile
        ? `${file.extractedText.slice(0, perFile)}\n…[truncated]`
        : file.extractedText;
    return `--- FILE: ${file.fileName} ---\n${text}`;
  });
  return `The user attached the following file(s) for this message:\n\n${blocks.join('\n\n')}`;
}

/**
 * Assemble the messages array for `provider.stream`. Prior turns are passed as-is;
 * this turn's message gets the attachment context prepended (the DB keeps the
 * user's original text — the file text lives in the attachments, not the message).
 */
export function assembleAssistantMessages(params: {
  readonly history: readonly AIMessage[];
  readonly message: string;
  readonly attachmentContext: string;
}): AIMessage[] {
  const content =
    params.attachmentContext === ''
      ? params.message
      : `${params.attachmentContext}\n\n---\n\n${params.message}`;
  return [...params.history, { role: 'user', content }];
}

/** First N words of the user message, tidied — the heuristic title fallback. */
function heuristicTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 8).join(' ');
  const title = words.length > 60 ? `${words.slice(0, 57)}…` : words;
  return title === '' ? 'New conversation' : title;
}

/**
 * Auto-title a conversation from its first exchange. Makes ONE short, cheap
 * non-streaming provider call; on any failure (or an empty/oversized reply) falls
 * back to a heuristic from the first user message so titling never blocks a chat.
 */
export async function generateChatTitle(
  provider: AIProvider,
  model: string,
  firstMessage: string,
  firstReply: string,
): Promise<string> {
  try {
    const result = await provider.generate({
      model,
      system:
        'Generate a short, specific title (3–6 words) for this conversation. ' +
        'Reply with ONLY the title — no surrounding quotes and no trailing punctuation.',
      messages: [
        {
          role: 'user',
          content: `First message:\n${firstMessage.slice(0, 1000)}\n\nReply:\n${firstReply.slice(0, 1000)}`,
        },
      ],
      temperature: 0.2,
    });
    const cleaned = result.content.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.]+$/, '').trim();
    if (cleaned === '') return heuristicTitle(firstMessage);
    return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
  } catch {
    return heuristicTitle(firstMessage);
  }
}
