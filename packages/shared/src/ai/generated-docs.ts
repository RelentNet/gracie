/**
 * The six generated document types (docs/06 §3) and their fixed generation order
 * (docs/06 §4 — sequential, D7). Metadata only: the per-type prompt instruction
 * is supplied by the pipeline at call time (kept out of @gracie/shared so prompt
 * wording stays tunable). Documents 3 (Client-Facing Summary) and 6 (Client Email
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
