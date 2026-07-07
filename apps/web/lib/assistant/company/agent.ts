/**
 * Company-aware agent loop for the Assistant (P6B.1). SERVER-ONLY. §C of the brief.
 *
 * Two-phase turn (keeps token-by-token streaming for the user-facing reply):
 *   Phase 1 (here) — BUFFERED tool rounds. Advertise the read-only tools, let the
 *     model call them, execute each server-side (role-gated, via executeCompanyTool),
 *     append the results, and repeat until the model stops asking for tools (or the
 *     round cap is hit). Returns the augmented message list.
 *   Phase 2 (the route) — STREAM the final answer from that augmented list with
 *     tools disabled, so the reply is a normal text stream.
 *
 * SECURITY: the caller identity is fixed for the whole turn. Tool ARGUMENTS never
 * change which caller the gates use, and every tool is read-only — so no retrieved
 * text or crafted argument can widen access or mutate state.
 */
import 'server-only';

import type { AIMessage, AIProvider } from '@gracie/shared';

import { COMPANY_TOOLS, executeCompanyTool } from './tools.js';
import type { CompanyCaller } from './access.js';

/** Max buffered generate rounds before we force a final answer. */
const MAX_TOOL_ROUNDS = 4;
/** Max tool calls honoured per round (defensive bound on model output). */
const MAX_TOOL_CALLS_PER_ROUND = 8;

export interface ResolveToolsParams {
  readonly provider: AIProvider;
  readonly model: string;
  readonly system: string;
  /** History + attachment context + the new user message (Phase-1 starting point). */
  readonly baseMessages: readonly AIMessage[];
  readonly caller: CompanyCaller;
  readonly temperature?: number;
}

export interface ResolveToolsResult {
  /** The full message list after tool resolution — ready to stream a final answer. */
  readonly messages: AIMessage[];
  /** How many tool calls were executed (telemetry / debugging). */
  readonly toolCallCount: number;
}

/**
 * Run Phase 1: buffered tool rounds. Returns the augmented message list (base
 * messages plus any assistant tool-call turns and their tool results). The last
 * buffered assistant answer is intentionally discarded — the route re-generates it
 * as a stream so the user sees a normal token-by-token reply.
 */
export async function resolveCompanyTools(params: ResolveToolsParams): Promise<ResolveToolsResult> {
  const working: AIMessage[] = [...params.baseMessages];
  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await params.provider.generate({
      model: params.model,
      system: params.system,
      messages: working,
      tools: COMPANY_TOOLS,
      toolChoice: 'auto',
      temperature: params.temperature,
    });

    const calls = (result.toolCalls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND);
    if (calls.length === 0) break; // model is ready to answer

    // Record the assistant's tool-call turn, then each tool's result. Keeping the
    // exact call ids paired with their results is required by the tool protocol.
    working.push({ role: 'assistant', content: result.content, toolCalls: calls });
    for (const call of calls) {
      const output = await executeCompanyTool(call.name, call.arguments, params.caller);
      working.push({ role: 'tool', toolCallId: call.id, content: output });
      toolCallCount += 1;
    }
  }

  return { messages: working, toolCallCount };
}
