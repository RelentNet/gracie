/**
 * POST /api/ai/chat — Intelligence chat (Tab 7, docs/05 + docs/06 §7).
 *
 * Any role. Body: `{ clientId, message, includeKnowledgeBase?, history? }`.
 * Embeds the query, retrieves this client's chunks (role-filtered — a non-admin
 * NEVER receives transcript-sourced chunks, D14), optionally merges global
 * Knowledge Base chunks, assembles a chat prompt, and STREAMS the answer token by
 * token via the provider interface (`provider.stream`, never the OpenAI SDK; D11).
 *
 * Pre-flight failures (auth/validation/missing client/embedding/provider key)
 * return a JSON error. Once streaming has begun the HTTP status is already 200, so
 * a mid-stream provider error is logged and surfaced as a short inline notice.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getActiveProvider } from '@gracie/db';
import { assembleChatPrompt, type AIMessage } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { resolveTools } from '@/lib/ai/tool-loop';
import { WEB_TOOLS, executeWebTool } from '@/lib/ai/web-tools';
import { webAccessGuidance } from '@/lib/ai/web-prompt';
import {
  getChatClient,
  getGaCompanyDescription,
  retrieveContext,
} from '@/lib/data/chat-retrieval';

// @gracie/db (supabase-js, crypto) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

/** Prior turns accepted from the client (the assembler trims to recent history). */
const MAX_HISTORY = 20;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Coerce untrusted `history` into well-formed `AIMessage[]`. */
function parseHistory(raw: unknown): AIMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: AIMessage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role === 'user' || role === 'assistant') && typeof content === 'string' && content !== '') {
      messages.push({ role, content });
    }
  }
  return messages.slice(-MAX_HISTORY);
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const includeKnowledgeBase = body.includeKnowledgeBase === true;
    // Per-chat "Web" toggle — advertises the on-demand web tools this turn.
    const webAccess = body.webAccess === true;
    const history = parseHistory(body.history);

    if (clientId === '') return jsonError('bad_request', 'clientId is required', 400);
    if (message === '') return jsonError('bad_request', 'message is required', 400);

    const user = await getRequestUser();

    const client = await getChatClient(clientId);
    if (client === null) return jsonError('not_found', 'Client not found', 404);

    const [{ clientChunks, knowledgeBaseChunks }, gaCompanyDescription] = await Promise.all([
      retrieveContext({ clientId, query: message, role: user.role, includeKnowledgeBase }),
      getGaCompanyDescription(),
    ]);

    const { system, messages } = assembleChatPrompt({
      gaCompanyDescription,
      clientDescription: client.description,
      clientName: client.name,
      clientChunks,
      knowledgeBaseChunks,
      history,
      message,
    });
    // Fold in the internet-access guidance for the per-chat "Web" toggle.
    const systemPrompt = `${system}\n\n${webAccessGuidance(webAccess)}`;

    // Resolve the provider before opening the stream so a missing-key failure
    // returns a clean JSON error rather than an empty 200 stream.
    const { provider, model } = await getActiveProvider();

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        let produced = 0;
        try {
          // Phase 1 (buffered): when the Web toggle is on, let the model call the
          // web tools; degrade to a plain answer if resolution fails. Retrieval is
          // already role-gated upstream — web tools add only public-internet data.
          let turnMessages: readonly AIMessage[] = messages;
          if (webAccess) {
            try {
              const resolved = await resolveTools({
                provider,
                model,
                system: systemPrompt,
                baseMessages: messages,
                tools: WEB_TOOLS,
                execute: executeWebTool,
                temperature: 0.3,
              });
              turnMessages = resolved.messages;
            } catch (toolError) {
              console.error('intelligence tool resolution failed, answering without web:', toolError);
            }
          }
          // Phase 2 (streamed): final answer with tools off.
          for await (const token of provider.stream({
            model,
            system: systemPrompt,
            messages: turnMessages,
            temperature: 0.3,
          })) {
            produced += 1;
            controller.enqueue(encoder.encode(token));
          }
        } catch (error) {
          console.error('chat stream error:', error);
          // Pre-stream failures already returned JSON; here the 200 stream is open.
          // Signal the failure inline so a truncated turn is distinguishable from a
          // complete one (whether it failed before any token or mid-response).
          controller.enqueue(
            encoder.encode(
              produced === 0
                ? '_The assistant could not generate a response. Please try again._'
                : '\n\n_[response interrupted]_',
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('chat_failed', message, 500);
  }
}
