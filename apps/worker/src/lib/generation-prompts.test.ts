/**
 * Editable generation-prompt resolution (PE). Guards the pure override-else-default
 * logic the worker uses to turn the stored `generation_prompt_overrides` value into
 * the six effective prompts — no DB, no LLM.
 *
 * Invariants:
 *   - every default is a non-empty string (all six docs always generate a prompt),
 *   - a non-blank override wins for its doc; every other doc keeps its default,
 *   - blank / whitespace / non-string / missing / garbage overrides fall back to the
 *     default, so a malformed setting can never blank out a prompt.
 *
 * Pure — run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_GENERATION_PROMPTS,
  GENERATED_DOC_ORDER,
  resolveGenerationPrompts,
} from '@gracie/shared';

test('all six default prompts are present and non-empty', () => {
  assert.equal(GENERATED_DOC_ORDER.length, 6);
  for (const type of GENERATED_DOC_ORDER) {
    const def = DEFAULT_GENERATION_PROMPTS[type];
    assert.equal(typeof def, 'string');
    assert.ok(def.trim().length > 0, `default for ${type} must be non-empty`);
  }
});

test('a non-blank override wins for its doc; the rest stay default', () => {
  const resolved = resolveGenerationPrompts({ post_meeting_analysis: 'Custom analysis prompt.' });
  assert.equal(resolved.post_meeting_analysis, 'Custom analysis prompt.');
  for (const type of GENERATED_DOC_ORDER) {
    if (type === 'post_meeting_analysis') continue;
    assert.equal(resolved[type], DEFAULT_GENERATION_PROMPTS[type]);
  }
});

test('blank / non-string / missing / garbage overrides fall back to defaults', () => {
  // Blank + whitespace-only + wrong-typed entries all fall back.
  const mixed = resolveGenerationPrompts({
    post_meeting_analysis: '',
    internal_memo: '   ',
    client_summary: 42,
    task_checklist: 'Keep the JSON shape but reworded.',
  });
  assert.equal(mixed.post_meeting_analysis, DEFAULT_GENERATION_PROMPTS.post_meeting_analysis);
  assert.equal(mixed.internal_memo, DEFAULT_GENERATION_PROMPTS.internal_memo);
  assert.equal(mixed.client_summary, DEFAULT_GENERATION_PROMPTS.client_summary);
  assert.equal(mixed.task_checklist, 'Keep the JSON shape but reworded.');

  // Absent / malformed top-level values → all defaults, every type present.
  for (const bad of [null, undefined, 'a string', ['array'], 123]) {
    const resolved = resolveGenerationPrompts(bad);
    for (const type of GENERATED_DOC_ORDER) {
      assert.equal(resolved[type], DEFAULT_GENERATION_PROMPTS[type]);
    }
  }
});
