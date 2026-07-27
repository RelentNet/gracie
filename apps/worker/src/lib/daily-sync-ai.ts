/**
 * Optional AI narrative for the daily sync (`{ai_brief}`, DS). The compose is fed
 * ONLY our own assembled facts — today's meetings, the deterministic per-meeting
 * briefs (transcript-derived), at-risk clients, yesterday's rollup, and last week's
 * open to-dos — via the SAME text renderers the email uses, so the model can't see
 * anything we didn't compute. No web/tools are wired into this path; grounding is
 * structural, not just prompt-instructed. Failure is the caller's to swallow (the
 * deterministic email always sends).
 */
import { assemblePrompt, type AIProvider, type DailySyncContent } from '@gracie/shared';

import { renderDailySyncBody, type DailySyncEmailInput } from './email-templates/daily-sync.js';

/**
 * Facts-only template: the block shortcodes that carry data, rendered to text. NO
 * greeting, button, or AI shortcode — just the ground truth the narrative may use.
 */
const FACTS_TEMPLATE = [
  'Date: {sync_date}',
  '',
  '{yesterday_activity}',
  '{todays_meetings}',
  '{at_risk_clients}',
  '{pre_meeting_briefs}',
  '{last_week_todos}',
].join('\n');

/**
 * Build the plain-text facts block handed to the model. Pure — reuses the email's
 * text renderers so the source is exactly what the email shows. Unit-tested to
 * contain only provided facts.
 */
export function buildAiBriefSource(content: DailySyncContent, syncDateLabel: string): string {
  const input: DailySyncEmailInput = { recipientName: '', syncDateLabel, content, appUrl: '' };
  return renderDailySyncBody(FACTS_TEMPLATE, content, input, 'text');
}

export interface ComposeAiBriefDeps {
  readonly provider: AIProvider;
  readonly model: string;
  /** Firm description (layer 1) — our own data, gives the model house context. */
  readonly gaCompanyDescription: string;
}

/**
 * Compose the `{ai_brief}` narrative from the assembled facts using the editable
 * prompt. Grounded via `assemblePrompt` (which also appends the [VERIFY]/tone rules).
 * Throws on provider failure — the caller wraps this in try/catch and falls back.
 */
export async function composeAiBrief(
  deps: ComposeAiBriefDeps,
  args: { readonly prompt: string; readonly source: string },
): Promise<string> {
  const { system, messages } = assemblePrompt(
    {
      gaCompanyDescription: deps.gaCompanyDescription,
      clientDescription: '',
      documentInstruction: args.prompt,
      consultantContext: '',
      historicalContext: '',
      sourceContent: args.source,
    },
    { responseFormat: 'text' },
  );
  const result = await deps.provider.generate({ model: deps.model, system, messages, responseFormat: 'text' });
  return result.content.trim();
}
