/**
 * Generic buffered tool-calling loop (P6B.2). SERVER-ONLY.
 *
 * Extracted from P6B.1's company loop so any surface can run the same Phase-1
 * pattern with its own tool set + executor: advertise `tools`, let the model call
 * them, execute each via `execute`, append the results, repeat until the model is
 * ready to answer (or the round cap). The caller then STREAMS the final answer with
 * tools off (Phase 2), preserving token-by-token streaming.
 *
 * Used by the Assistant (company tools + optional web tools) and the Intelligence
 * chat (optional web tools). `execute` is injected, so this file knows nothing about
 * roles or gating — those live in the executors it is given.
 */
import 'server-only';

import type { AIMessage, AIProvider, AITool } from '@gracie/shared';

/** Max buffered generate rounds before we force a final answer. */
const MAX_TOOL_ROUNDS = 4;
/** Max tool calls honoured per round (defensive bound on model output). */
const MAX_TOOL_CALLS_PER_ROUND = 8;

/** Executes one tool call and returns its result as a string. Must never throw. */
export type ToolExecutor = (name: string, rawArgs: string) => Promise<string>;

export interface ResolveToolsParams {
  readonly provider: AIProvider;
  readonly model: string;
  readonly system: string;
  /** History + context + the new user message (Phase-1 starting point). */
  readonly baseMessages: readonly AIMessage[];
  readonly tools: readonly AITool[];
  readonly execute: ToolExecutor;
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
 * messages plus any assistant tool-call turns and their tool results). Returns the
 * base messages unchanged when no tools are supplied. The last buffered assistant
 * answer is intentionally discarded — the route re-generates it as a stream.
 */
export async function resolveTools(params: ResolveToolsParams): Promise<ResolveToolsResult> {
  const working: AIMessage[] = [...params.baseMessages];
  let toolCallCount = 0;
  if (params.tools.length === 0) return { messages: working, toolCallCount };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await params.provider.generate({
      model: params.model,
      system: params.system,
      messages: working,
      tools: params.tools,
      toolChoice: 'auto',
      temperature: params.temperature,
    });

    const calls = (result.toolCalls ?? []).slice(0, MAX_TOOL_CALLS_PER_ROUND);
    if (calls.length === 0) break; // model is ready to answer

    // Record the assistant's tool-call turn, then each tool's result. Keeping the
    // exact call ids paired with their results is required by the tool protocol.
    working.push({ role: 'assistant', content: result.content, toolCalls: calls });
    for (const call of calls) {
      const output = await params.execute(call.name, call.arguments);
      working.push({ role: 'tool', toolCallId: call.id, content: output });
      toolCallCount += 1;
    }
  }

  return { messages: working, toolCallCount };
}
