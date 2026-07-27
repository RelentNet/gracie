/**
 * The six generated document types (docs/06 §3) and their fixed generation order
 * (docs/06 §4 — sequential, D7), plus their DEFAULT per-type prompt instructions
 * (`DEFAULT_GENERATION_PROMPTS`). The defaults live here (PE) so web + worker share
 * ONE source: the Settings UI shows/edits them and the worker falls back to them
 * when there's no override. Documents 3 (Client-Facing Summary) and 6 (Client Email
 * Draft) are `requiresReview` and are NEVER auto-sent (docs/06 §3 absolute rule).
 */
export type GeneratedDocType =
  | 'post_meeting_analysis'
  | 'internal_memo'
  | 'client_summary'
  | 'task_checklist'
  | 'internal_email'
  | 'client_email';

export interface GeneratedDocSpec {
  readonly type: GeneratedDocType;
  /** 1-based sequential generation order (D7). */
  readonly order: number;
  readonly label: string;
  readonly audience: 'internal' | 'client';
  /** True → never auto-sent; staged for explicit human review (docs 3 & 6). */
  readonly requiresReview: boolean;
  /** Task Checklist forces JSON output (docs/06 §6); the others are prose. */
  readonly responseFormat: 'text' | 'json';
}

export const GENERATED_DOC_SPECS: readonly GeneratedDocSpec[] = [
  {
    type: 'post_meeting_analysis',
    order: 1,
    label: 'Post-Meeting Analysis',
    audience: 'internal',
    requiresReview: false,
    responseFormat: 'text',
  },
  {
    type: 'internal_memo',
    order: 2,
    label: 'Internal Memo',
    audience: 'internal',
    requiresReview: false,
    responseFormat: 'text',
  },
  {
    type: 'client_summary',
    order: 3,
    label: 'Client-Facing Summary',
    audience: 'client',
    requiresReview: true,
    responseFormat: 'text',
  },
  {
    type: 'task_checklist',
    order: 4,
    label: 'Task Checklist',
    audience: 'internal',
    requiresReview: false,
    responseFormat: 'json',
  },
  {
    type: 'internal_email',
    order: 5,
    label: 'Internal Email Draft',
    audience: 'internal',
    requiresReview: false,
    responseFormat: 'text',
  },
  {
    type: 'client_email',
    order: 6,
    label: 'Client Email Draft',
    audience: 'client',
    requiresReview: true,
    responseFormat: 'text',
  },
] as const;

/** Doc types in their sequential generation order (docs/06 §4). */
export const GENERATED_DOC_ORDER: readonly GeneratedDocType[] = GENERATED_DOC_SPECS.map(
  (spec) => spec.type,
);

/** Look up a doc spec by type; throws on an unknown type. */
export function getDocSpec(type: GeneratedDocType): GeneratedDocSpec {
  const spec = GENERATED_DOC_SPECS.find((candidate) => candidate.type === type);
  if (spec === undefined) {
    throw new Error(`Unknown generated doc type: ${type}`);
  }
  return spec;
}

/**
 * Default per-document instruction (layer 3 — "Your Task") for each of the six
 * generated docs. Each describes what to produce from the meeting transcript in a
 * polished federal healthcare-consulting voice; the global [VERIFY]/tone/JSON rules
 * are appended by `assemblePrompt` at call time.
 *
 * These are the EDITABLE defaults (PE): an admin can override any of them from
 * Settings → Generation Prompts, and the worker falls back to the value here when a
 * doc has no override. Keep `task_checklist`'s exact JSON shape if you edit it — the
 * worker parses that response into `tasks`, so a changed shape breaks task extraction.
 */
export const DEFAULT_GENERATION_PROMPTS: Record<GeneratedDocType, string> = {
  post_meeting_analysis: [
    'Produce a thorough INTERNAL Post-Meeting Analysis of this client meeting.',
    'Cover: the decisions reached, the key discussion points and any disagreement,',
    'risks or blockers surfaced, commitments made by either side, and notable',
    'changes in client sentiment or relationship health. Be candid and analytical —',
    'this is for the internal consulting team, not the client. Use clear Markdown',
    'headings and bullet points.',
  ].join(' '),
  internal_memo: [
    'Write a concise INTERNAL Memo summarizing this meeting for the wider team.',
    'Lead with a one-line TL;DR, then cover what happened, what was decided, and the',
    'immediate next steps with owners where stated. Keep it skimmable — short',
    'paragraphs and bullets. Internal audience.',
  ].join(' '),
  client_summary: [
    'Draft a polished CLIENT-FACING Summary of this meeting suitable for sending to',
    'the client. Recap the purpose, what was discussed and agreed, and the agreed',
    'next steps and owners. Professional, reassuring, and precise; omit any internal-',
    'only commentary, candor about relationship health, or speculation. This is a',
    'DRAFT staged for human review — it is never auto-sent.',
  ].join(' '),
  task_checklist: [
    'Extract every actionable follow-up task from this meeting as STRUCTURED JSON.',
    'Respond with ONLY a single JSON object of this exact shape:',
    '{"tasks":[{"description":string,"owner_hint":string|null,"due_hint":string|null,"priority":boolean}]}.',
    'Rules: "description" is an imperative, specific action; "owner_hint" is the name',
    'or role named as responsible (else null); "due_hint" is any natural-language due',
    'date mentioned (else null); "priority" is true only when the meeting marked it',
    'urgent/high-priority. If there are no tasks, return {"tasks":[]}. No prose, no',
    'Markdown fences — JSON only.',
  ].join(' '),
  internal_email: [
    'Write an INTERNAL Email Draft the team can send to colleagues to circulate the',
    'meeting outcomes. Include a subject line, a brief greeting, the key outcomes and',
    'action items, and a sign-off. Internal tone — direct and informative. Stored for',
    'the team to retrieve and send manually.',
  ].join(' '),
  client_email: [
    'Draft a CLIENT-FACING Email the consultant could send to the client to follow up',
    'on this meeting. Include a subject line, a professional greeting, a short recap,',
    'the agreed next steps, and a courteous sign-off. Warm but precise federal-',
    'consulting tone. This is a DRAFT staged for review — it is NEVER auto-sent.',
  ].join(' '),
};

/**
 * Resolve the effective per-doc prompt map from a stored overrides value (the
 * `settings.generation_prompt_overrides` jsonb): for each doc type, use the override
 * when it's a non-blank string, else the default. Defensive about shape — a
 * missing/garbage/array value is treated as "no overrides" — so the worker tolerates
 * the key being absent or malformed and always gets all six prompts.
 */
export function resolveGenerationPrompts(overrides: unknown): Record<GeneratedDocType, string> {
  const map =
    overrides !== null && typeof overrides === 'object' && !Array.isArray(overrides)
      ? (overrides as Record<string, unknown>)
      : {};
  const resolved = {} as Record<GeneratedDocType, string>;
  for (const type of GENERATED_DOC_ORDER) {
    const override = map[type];
    resolved[type] =
      typeof override === 'string' && override.trim() !== ''
        ? override
        : DEFAULT_GENERATION_PROMPTS[type];
  }
  return resolved;
}
