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
import {
  ASSISTANT_SYSTEM_PROMPT,
  assembleAssistantMessages,
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
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const chatId = typeof body.chatId === 'string' && body.chatId !== '' ? body.chatId : null;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const attachmentIds = parseAttachmentIds(body.attachmentIds);

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

    // Persist the user's message up front so it survives a stream failure.
    await insertMessage({ chatId: chatIdResolved, role: 'user', content: message, attachmentIds });

    const promptTokens = estimateTokens(
      ASSISTANT_SYSTEM_PROMPT + messages.map((m) => m.content).join('\n'),
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        let answer = '';
        try {
          for await (const token of provider.stream({
            model,
            system: ASSISTANT_SYSTEM_PROMPT,
            messages,
            temperature: 0.3,
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
      },
    });
  } catch (error) {
    return jsonError('chat_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
