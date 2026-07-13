/**
 * POST /api/assistant/chat — send a message and STREAM the assistant's reply.
 *
 * Body: `{ chatId?, message, attachmentIds? }`. Any role, own-only. Mirrors the
 * Intelligence streaming route (docs/05): resolve the provider before opening the
 * stream (so a missing-key failure returns clean JSON, not an empty 200), stream
 * tokens via `provider.stream` (never the OpenAI SDK, D11), then persist the user
 * + assistant messages, auto-title on the first exchange, and record token usage.
 *
 * When `chatId` is omitted a new conversation is created and its id is returned in
 * the `X-Chat-Id` response header (the client reads it before consuming the body).
 * When present it is ownership-checked; a chat the caller does not own yields 404.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getActiveProvider } from '@gracie/db';
import type { AIMessage } from '@gracie/shared';

import { getAssistantUser } from '@/lib/assistant/user';
import { toCompanyCaller } from '@/lib/assistant/company/access';
import { COMPANY_TOOLS, executeCompanyTool } from '@/lib/assistant/company/tools';
import {
  ACTION_TOOLS,
  ACTION_TOOL_NAMES,
  executeAssistantAction,
  type ActionContext,
} from '@/lib/assistant/actions/tools';
import type { AutomationProposal } from '@/lib/assistant/actions/proposal';
import { WEB_TOOLS, WEB_TOOL_NAMES, executeWebTool } from '@/lib/ai/web-tools';
import { resolveTools, type ToolExecutor } from '@/lib/ai/tool-loop';
import {
  assembleAssistantMessages,
  buildAssistantSystemPrompt,
  buildAttachmentContext,
  estimateTokens,
  generateChatTitle,
} from '@/lib/assistant/prompt';
import {
  createChat,
  getAttachmentsForContext,
  getChatWithMessages,
  insertMessage,
  updateChat,
} from '@/lib/data/assistant';
import { getGaCompanyDescription } from '@/lib/data/chat-retrieval';

export const runtime = 'nodejs';

/** Prior turns replayed to the model — cap to keep the prompt bounded. */
const MAX_HISTORY = 20;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Coerce a raw `attachmentIds` value into a bounded string[]. */
function parseAttachmentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, 10);
}

export async function POST(req: NextRequest): Promise<Response> {
  let ownerId: string;
  let caller: ReturnType<typeof toCompanyCaller>;
  try {
    const assistantUser = await getAssistantUser();
    ownerId = assistantUser.id;
    // The caller's role is DB-authoritative; company tools + retrieval mirror it.
    caller = toCompanyCaller({ userId: assistantUser.id, role: assistantUser.role });
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chatId = typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : null;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const attachmentIds = parseAttachmentIds(body.attachmentIds);
    // Per-chat "Web" toggle — advertises the on-demand web tools this turn.
    const webAccess = body.webAccess === true;

    if (message === '') return jsonError('bad_request', 'message is required', 400);

    // Resolve the provider FIRST so a missing/invalid key fails as clean JSON.
    const { provider, model: activeModel } = await getActiveProvider();

    // Resolve (or create) the conversation, ownership-checked, and load history.
    let chatIdResolved: string;
    let model: string;
    let history: AIMessage[] = [];
    let isNewChat = false;

    if (chatId !== null) {
      const existing = await getChatWithMessages(ownerId, chatId);
      if (existing === null) return jsonError('not_found', 'Conversation not found', 404);
      chatIdResolved = existing.chat.id;
      model = existing.chat.model ?? activeModel;
      history = existing.messages
        .map((m): AIMessage => ({ role: m.role, content: m.content }))
        .slice(-MAX_HISTORY);
      isNewChat = existing.messages.length === 0;
    } else {
      const created = await createChat(ownerId, activeModel);
      chatIdResolved = created.id;
      model = activeModel;
      isNewChat = true;
    }

    // Read this turn's attachment text (ownership + chat-scope enforced).
    const files = await getAttachmentsForContext(ownerId, chatIdResolved, attachmentIds);
    const attachmentContext = buildAttachmentContext(files);
    const messages = assembleAssistantMessages({ history, message, attachmentContext });

    // Company-aware system prompt: fold in the firm description (settings, never
    // hardcoded) and the read-only tool contract. Resolved before the stream so a
    // failure is a clean JSON error, not an empty 200.
    const gaCompanyDescription = await getGaCompanyDescription();
    const system = buildAssistantSystemPrompt(gaCompanyDescription, webAccess);

    // Persist the user's message up front so it survives a stream failure.
    await insertMessage({ chatId: chatIdResolved, role: 'user', content: message, attachmentIds });

    const TEMPERATURE = 0.3;

    // Phase 1 (buffered) — HOISTED out of the stream so any automation PROPOSAL is
    // known before the response headers go out (surfaced via `X-Assistant-Action`).
    // The write tools (create_automation / request_advanced_automation) only PROPOSE
    // — create_automation persists a `pending_confirmation` row and returns it; it
    // NEVER activates or sends. Activation is the separate gated /confirm route.
    // Degrade to a plain answer if resolution fails so a tool hiccup never breaks chat.
    const proposals: AutomationProposal[] = [];
    let resolvedMessages: AIMessage[] = messages;
    try {
      const actionCtx: ActionContext = { ownerUserId: ownerId };
      // Company (read) tools + the agentic action tools always; web tools only when
      // the Web toggle is on.
      const tools = [...COMPANY_TOOLS, ...ACTION_TOOLS, ...(webAccess ? WEB_TOOLS : [])];
      const execute: ToolExecutor = (name, args) => {
        if (ACTION_TOOL_NAMES.has(name)) return executeAssistantAction(name, args, actionCtx, proposals);
        if (WEB_TOOL_NAMES.has(name)) return executeWebTool(name, args);
        return executeCompanyTool(name, args, caller);
      };
      const resolved = await resolveTools({
        provider,
        model,
        system,
        baseMessages: messages,
        tools,
        execute,
        temperature: TEMPERATURE,
      });
      resolvedMessages = resolved.messages;
    } catch (toolError) {
      console.error('assistant tool resolution failed, answering without tools:', toolError);
    }

    // Surface the FIRST proposal created this turn as a confirm card (URL-encoded
    // JSON header — read by the client before it consumes the stream body).
    const actionHeader =
      proposals.length > 0 ? encodeURIComponent(JSON.stringify(proposals[0])) : null;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        let answer = '';
        try {
          // Phase 2 (streamed): final answer, tools disabled → normal text stream.
          for await (const token of provider.stream({
            model,
            system,
            messages: resolvedMessages,
            temperature: TEMPERATURE,
          })) {
            answer += token;
            controller.enqueue(encoder.encode(token));
          }
        } catch (error) {
          console.error('assistant stream error:', error);
          controller.enqueue(
            encoder.encode(
              answer === ''
                ? '_The assistant could not generate a response. Please try again._'
                : '\n\n_[response interrupted]_',
            ),
          );
        } finally {
          try {
            // Persist a partial answer too (spec §8) — nothing to save only if
            // zero tokens arrived.
            if (answer !== '') {
              const promptTokens = estimateTokens(
                system + resolvedMessages.map((m) => m.content).join('\n'),
              );
              await insertMessage({
                chatId: chatIdResolved,
                role: 'assistant',
                content: answer,
                tokenUsage: {
                  prompt: promptTokens,
                  completion: estimateTokens(answer),
                  estimated: true,
                },
              });
            }
            if (isNewChat) {
              const title = await generateChatTitle(provider, model, message, answer);
              await updateChat(ownerId, chatIdResolved, { title });
            } else {
              await updateChat(ownerId, chatIdResolved, {}); // bump updated_at
            }
          } catch (persistError) {
            console.error('assistant persist error:', persistError);
          } finally {
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Chat-Id': chatIdResolved,
        ...(actionHeader !== null ? { 'X-Assistant-Action': actionHeader } : {}),
      },
    });
  } catch (error) {
    return jsonError('chat_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
