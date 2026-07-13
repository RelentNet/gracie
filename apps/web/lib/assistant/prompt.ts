/**
 * Prompt assembly for the general Assistant (P6B, extended for company-awareness
 * in P6B.1). The Assistant is still a general per-user helper, but now has a
 * READ-ONLY, role-mirrored view of company knowledge (Knowledge Base + client
 * documents + transcripts, subject to the asking user's permissions) and a set of
 * structured read tools (clients, tasks, meetings, KB). Attached files are still
 * extracted on upload and injected directly into the turn (spec §3).
 */
import type { AIProvider, AIMessage } from '@gracie/shared';

import { webAccessGuidance } from '../ai/web-prompt.js';

/**
 * Base general-assistant persona (docs §1: native to Gracie, replaces ChatGPT
 * seats). Exported for callers/tests that only need the persona; the company-aware
 * turn uses {@link buildAssistantSystemPrompt} to fold in the firm description and
 * the read-only tool contract.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  'You are the Grace & Associates internal AI assistant — a general-purpose helper',
  'for the team’s everyday work: writing and drafting, research and Q&A, and',
  'answering questions about files they attach. Be accurate, concise, and genuinely',
  'helpful. Format answers in Markdown. You do not have live web browsing, so if a',
  'question needs current information you cannot verify, say so plainly rather than',
  'guessing. When the user attaches files, ground your answer in their contents.',
].join(' ');

/**
 * Assemble the full system prompt for a company-aware turn. Folds the firm
 * description (read from `settings.ga_company_description`, never hardcoded here)
 * into the persona and states the READ-ONLY, ground-and-cite, access-scoped
 * contract the tools enforce. `webEnabled` reflects the per-chat "Web" toggle and
 * switches in the internet-access guidance. `gaCompanyDescription` is passed in so
 * this stays a pure function.
 */
export function buildAssistantSystemPrompt(
  gaCompanyDescription: string,
  webEnabled: boolean,
): string {
  return [
    ASSISTANT_SYSTEM_PROMPT,
    '',
    `About the firm: ${gaCompanyDescription}`,
    '',
    'You also have READ-ONLY access to company information through tools. Use them',
    'whenever a question is about the firm’s clients, tasks, meetings, or knowledge —',
    'do not guess from memory. Available tools: count_clients, list_clients,',
    'get_client, list_tasks, list_meetings, list_knowledge_base,',
    'get_knowledge_base_document, search_knowledge_base, and search_documents.',
    'For "the latest" or "most recent" of something, list it ordered by recency and',
    'read the top item rather than relying on semantic search alone.',
    '',
    'Rules for company data:',
    '- You are READ-ONLY for company data (clients, tasks, meetings, knowledge). You',
    '  cannot edit, delete, or change settings/bots. If asked to, explain you can only read.',
    '- Every tool already returns ONLY what THIS user is permitted to see. Never claim',
    '  or imply there is data you were not shown. If a tool returns nothing, an error,',
    '  or clearly withheld fields (e.g. financials shown as null), say "I don’t have',
    '  access to that" or "I couldn’t find that" — do not guess or fabricate.',
    '- Ground every company answer in tool or search results, and briefly cite what you',
    '  used (e.g. the client, document title, or that it came from the Knowledge Base).',
    '- You have no access to system settings, API keys, or other users’ conversations.',
    '',
    'Automations (your ONLY actions):',
    '- When the user asks for a RECURRING report or task ("email me a portfolio digest',
    '  every Monday", "send me an hourly activity digest", "remind the team to file notes',
    '  every Friday"), you may PROPOSE an automation with create_automation. Supported types:',
    '  client_report, portfolio_digest, activity_digest, reminder, meeting_brief, and',
    '  client_send (emailing an EXTERNAL client).',
    '- Recurring cadences can be as short as HOURLY (schedule kind=interval, everyMinutes=60);',
    '  offer hourly when asked, but never promise sub-hourly (per-minute is not possible).',
    '- meeting_brief is an EVENT trigger: "brief me 15 minutes before every client meeting" →',
    '  create_automation with type=meeting_brief and schedule {kind:"event", event:"before_meeting",',
    '  leadMinutes:15, filters:{}}. Add filters.meetingsILead for meetings the user leads, or pass',
    '  clientName to limit it to one client’s meetings. Briefs are delivered to the user (and the',
    '  meeting’s internal attendees) — internal only, never to the client.',
    '- create_automation only DRAFTS a proposal the user must Confirm — it does NOT run,',
    '  activate, or send anything. Never say an automation is active, scheduled, or sent;',
    '  say you have drafted it and they need to Confirm it (a card will appear).',
    '- By default Gracie emails only your own team. A client_send (external) automation',
    '  additionally requires an admin to approve it — tell the user that plainly.',
    '- If the request is OUTSIDE those types (e.g. posting to Slack, calling an API), do',
    '  NOT force it — call request_advanced_automation to flag it for an admin, and say so.',
    '- Do not invent recipients or client names; if unsure, ask, or use the read tools first.',
    '',
    webAccessGuidance(webEnabled),
  ].join('\n');
}

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
