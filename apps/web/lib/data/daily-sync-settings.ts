/**
 * Daily-sync template settings data layer (Settings → Daily Sync, DS). Admin-only
 * surface over three settings the worker reads: the editable email-body template
 * (`daily_sync_email_template`), the optional AI-brief prompt
 * (`daily_sync_ai_brief_prompt`), and the AI-brief on/off switch
 * (`daily_sync_ai_brief_enabled`, default OFF).
 *
 * Template + prompt are stored as JSON strings (to match the worker's
 * `readStringSetting` reader); a blank OR unchanged-from-default value is dropped, so
 * "Reset to default" just removes the override. The switch is stored as 'true'/'false'
 * (matching the worker's `parseBool`). Server-only; permission is the API's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import {
  DEFAULT_AI_BRIEF_PROMPT,
  DEFAULT_DAILY_SYNC_TEMPLATE,
  resolveAiBriefPrompt,
  resolveDailySyncTemplate,
} from '@gracie/shared';

const TEMPLATE_KEY = 'daily_sync_email_template';
const AI_PROMPT_KEY = 'daily_sync_ai_brief_prompt';
const AI_ENABLED_KEY = 'daily_sync_ai_brief_enabled';
/** Generous but bounded — guards against absurd payloads. */
const MAX_LEN = 20000;

/** One editable text field: its default + effective value + whether it's overridden. */
export interface EditableText {
  readonly default: string;
  readonly effective: string;
  readonly isOverridden: boolean;
}

export interface DailySyncSettings {
  readonly template: EditableText;
  readonly aiPrompt: EditableText;
  readonly aiEnabled: boolean;
}

export interface DailySyncSettingsPatch {
  readonly template?: string;
  readonly aiPrompt?: string;
  readonly aiEnabled?: boolean;
}

/** Thrown on invalid input so the route can answer 400 (vs. 500). */
export class DailySyncSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailySyncSettingsValidationError';
  }
}

function parseBool(value: unknown): boolean {
  if (typeof value !== 'string') return false; // AI defaults OFF
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Read the three settings, merging defaults. */
export async function getDailySyncSettings(): Promise<DailySyncSettings> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('key, value')
    .in('key', [TEMPLATE_KEY, AI_PROMPT_KEY, AI_ENABLED_KEY]);
  if (error !== null) throw new Error(`getDailySyncSettings: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const templateRaw = byKey.get(TEMPLATE_KEY);
  const promptRaw = byKey.get(AI_PROMPT_KEY);

  const templateOverridden = typeof templateRaw === 'string' && templateRaw.trim() !== '';
  const promptOverridden = typeof promptRaw === 'string' && promptRaw.trim() !== '';

  return {
    template: {
      default: DEFAULT_DAILY_SYNC_TEMPLATE,
      effective: resolveDailySyncTemplate(templateRaw),
      isOverridden: templateOverridden,
    },
    aiPrompt: {
      default: DEFAULT_AI_BRIEF_PROMPT,
      effective: resolveAiBriefPrompt(promptRaw),
      isOverridden: promptOverridden,
    },
    aiEnabled: parseBool(byKey.get(AI_ENABLED_KEY)),
  };
}

/** Validate + normalize an editable-text field; returns the string to store, or null to drop it (reset). */
function normalizeText(label: string, value: string, defaultValue: string): string | null {
  if (value.length > MAX_LEN) {
    throw new DailySyncSettingsValidationError(`${label} must be ${MAX_LEN} characters or fewer.`);
  }
  const trimmed = value.trim();
  // Blank OR unchanged-from-default → no override (reset to default).
  if (trimmed === '' || trimmed === defaultValue.trim()) return null;
  return value;
}

/**
 * Persist the provided fields. Template/prompt are upserted (or cleared to '' when
 * reset, so the worker's blank→default kicks in); the switch is stored 'true'/'false'.
 * Returns fresh settings.
 */
export async function setDailySyncSettings(patch: DailySyncSettingsPatch): Promise<DailySyncSettings> {
  const rows: Array<{ key: string; value: string }> = [];

  if (patch.template !== undefined) {
    if (typeof patch.template !== 'string') throw new DailySyncSettingsValidationError('template must be text.');
    rows.push({ key: TEMPLATE_KEY, value: normalizeText('Template', patch.template, DEFAULT_DAILY_SYNC_TEMPLATE) ?? '' });
  }
  if (patch.aiPrompt !== undefined) {
    if (typeof patch.aiPrompt !== 'string') throw new DailySyncSettingsValidationError('aiPrompt must be text.');
    rows.push({ key: AI_PROMPT_KEY, value: normalizeText('AI prompt', patch.aiPrompt, DEFAULT_AI_BRIEF_PROMPT) ?? '' });
  }
  if (patch.aiEnabled !== undefined) {
    if (typeof patch.aiEnabled !== 'boolean') throw new DailySyncSettingsValidationError('aiEnabled must be a boolean.');
    rows.push({ key: AI_ENABLED_KEY, value: patch.aiEnabled ? 'true' : 'false' });
  }

  if (rows.length > 0) {
    const db = getServerClient();
    const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
    if (error !== null) throw new Error(`setDailySyncSettings: ${error.message}`);
  }
  return getDailySyncSettings();
}
