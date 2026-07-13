'use client';

/**
 * Scoring settings (Settings → Scoring, P9). Admin-only. Tunes the GLOBAL
 * relationship-health algorithm config (`settings.relationship_health_config`): the
 * four signal weights + the thresholds/intervals they feed. DB-backed via
 * `/api/settings/scoring`; saving enqueues a full recompute so retuned values take
 * effect immediately (no redeploy, no waiting for the nightly run).
 *
 * The signal SET is fixed (cadence adherence, meeting recency, open/overdue tasks,
 * completion rate) — this panel tunes their weights/params, it does not add or remove
 * signals. Per-client signal overrides live on each client's HealthCard, not here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import type { ClientCadence, HealthConfig, HealthSignalKey } from '@gracie/shared';

interface ScoringResponse {
  readonly config: HealthConfig;
  readonly defaults: HealthConfig;
}
interface PatchResponse {
  readonly config: HealthConfig;
  readonly recompute: { readonly enqueued: boolean; readonly error?: string };
}

const WEIGHT_FIELDS: ReadonlyArray<{ readonly key: HealthSignalKey; readonly label: string }> = [
  { key: 'cadenceAdherence', label: 'Cadence adherence' },
  { key: 'meetingRecency', label: 'Meeting recency' },
  { key: 'openOverdueTasks', label: 'Open / overdue tasks' },
  { key: 'completionRate', label: 'Task completion rate' },
];

// Only the cadences that carry a meeting expectation (ad_hoc has none → omitted).
const CADENCE_FIELDS: ReadonlyArray<{ readonly key: ClientCadence; readonly label: string }> = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Biweekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'qbr', label: 'QBR (quarterly)' },
];

type ScalarKey =
  | 'recencyFullDays'
  | 'recencyZeroDays'
  | 'overduePenaltyPerTask'
  | 'overdueAgePenaltyPerDay'
  | 'noMeetingsScore'
  | 'trendCompareDays'
  | 'trendThreshold';

const SCALAR_FIELDS: ReadonlyArray<{
  readonly key: ScalarKey;
  readonly label: string;
  readonly help: string;
  readonly integer: boolean;
}> = [
  { key: 'recencyFullDays', label: 'Recency — full score within (days)', help: 'A meeting this recent scores 100 on recency.', integer: true },
  { key: 'recencyZeroDays', label: 'Recency — zero score at (days)', help: 'No meeting for this long scores 0. Must exceed the “full” days.', integer: true },
  { key: 'overduePenaltyPerTask', label: 'Overdue penalty — per task', help: 'Points subtracted from the tasks signal per overdue task.', integer: false },
  { key: 'overdueAgePenaltyPerDay', label: 'Overdue penalty — per overdue-day', help: 'Extra points subtracted per total overdue-day across tasks.', integer: false },
  { key: 'noMeetingsScore', label: 'Score for a never-met client (0–100)', help: 'The signal value given when a client has no completed meetings yet.', integer: true },
  { key: 'trendCompareDays', label: 'Trend — compare against (days ago)', help: 'Compare today’s score to the newest snapshot at least this old.', integer: true },
  { key: 'trendThreshold', label: 'Trend — min delta to move (points)', help: 'Score change of at least this reads as improving / declining vs stable.', integer: false },
];

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

/** Flatten a config into the form's string-keyed values. */
function toValues(c: HealthConfig): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of WEIGHT_FIELDS) v[`weights.${f.key}`] = String(c.weights[f.key] ?? 0);
  for (const f of CADENCE_FIELDS) v[`cadence.${f.key}`] = c.cadenceIntervalDays[f.key]?.toString() ?? '';
  for (const f of SCALAR_FIELDS) v[f.key] = String(c[f.key]);
  return v;
}

export function ScoringSettingsPanel(): React.JSX.Element {
  const [defaults, setDefaults] = useState<HealthConfig | null>(null);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ScoringResponse>('/api/settings/scoring')
      .then((d) => {
        if (!active) return;
        setDefaults(d.defaults);
        setValues(toValues(d.config));
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load scoring settings');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const set = useCallback((id: string, next: string): void => {
    setValues((prev) => (prev === null ? prev : { ...prev, [id]: next }));
    setMessage(null);
  }, []);

  // Live normalized weight split (the algorithm renormalizes over applicable signals).
  const normalized = useMemo(() => {
    if (values === null) return null;
    const nums = WEIGHT_FIELDS.map((f) => {
      const n = Number(values[`weights.${f.key}`]);
      return Number.isFinite(n) && n > 0 ? n : 0;
    });
    const sum = nums.reduce((s, n) => s + n, 0);
    return { sum, pct: nums.map((n) => (sum > 0 ? Math.round((n / sum) * 100) : 0)) };
  }, [values]);

  const save = useCallback((): void => {
    if (values === null) return;

    const parse = (id: string): number => {
      const t = (values[id] ?? '').trim();
      return t === '' ? NaN : Number(t);
    };

    // Every field must be a finite number before we send.
    const missing: string[] = [];
    const weights: Record<string, number> = {};
    let anyWeightPositive = false;
    for (const f of WEIGHT_FIELDS) {
      const n = parse(`weights.${f.key}`);
      if (!Number.isFinite(n)) missing.push(f.label);
      else if (n > 0) anyWeightPositive = true;
      weights[f.key] = n;
    }
    const cadenceIntervalDays: Record<string, number> = {};
    for (const f of CADENCE_FIELDS) {
      const n = parse(`cadence.${f.key}`);
      if (!Number.isFinite(n)) missing.push(`${f.label} interval`);
      cadenceIntervalDays[f.key] = n;
    }
    const scalars: Record<string, number> = {};
    for (const f of SCALAR_FIELDS) {
      const n = parse(f.key);
      if (!Number.isFinite(n)) missing.push(f.label);
      scalars[f.key] = n;
    }
    if (missing.length > 0) {
      setMessage({ text: `Please enter a number for: ${missing.join(', ')}.`, ok: false });
      return;
    }

    // Cheap client-side guards mirroring the server (surface the obvious ones early).
    if (!anyWeightPositive) {
      setMessage({ text: 'At least one signal weight must be greater than zero.', ok: false });
      return;
    }
    // Both are finite here (else they'd be in `missing` above and we'd have returned).
    if (parse('recencyZeroDays') <= parse('recencyFullDays')) {
      setMessage({ text: 'Recency “zero” days must be greater than “full” days.', ok: false });
      return;
    }

    setSaving(true);
    setMessage(null);
    apiClient
      .patch<PatchResponse>('/api/settings/scoring', { weights, cadenceIntervalDays, ...scalars })
      .then((d) => {
        setValues(toValues(d.config));
        setMessage(
          d.recompute.enqueued
            ? { text: 'Saved. Recomputing every client’s health with the new settings…', ok: true }
            : {
                text: `Saved, but the recompute couldn’t be queued (${d.recompute.error ?? 'unknown'}). Scores will refresh on the nightly run.`,
                ok: false,
              },
        );
      })
      .catch((e: unknown) => setMessage({ text: e instanceof Error ? e.message : 'Save failed.', ok: false }))
      .finally(() => setSaving(false));
  }, [values]);

  const restoreDefaults = useCallback((): void => {
    if (defaults === null) return;
    setValues(toValues(defaults));
    setMessage({ text: 'Loaded default values — review, then Save to apply.', ok: true });
  }, [defaults]);

  if (loadError !== null) return <ErrorState title="Couldn’t load scoring settings" description={loadError} />;
  if (values === null) return <LoadingState label="Loading scoring settings…" />;

  return (
    <div className="flex flex-col gap-6">
      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        The relationship-health score is a weighted 0–100 blend of four signals. Weights need not sum to 100 —
        the effective split is shown below. Saving recomputes every client’s score.
      </span>

      {/* Signal weights */}
      <fieldset className="flex flex-col gap-3">
        <legend style={TYPE.bodyStrong}>Signal weights</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {WEIGHT_FIELDS.map((f, i) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                {f.label}
                {normalized !== null ? (
                  <span className="font-data" style={{ color: 'var(--text-primary)' }}>
                    {' '}
                    · {normalized.pct[i] ?? 0}% effective
                  </span>
                ) : null}
              </span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className={inputClass}
                style={inputStyle}
                value={values[`weights.${f.key}`]}
                disabled={saving}
                onChange={(e): void => set(`weights.${f.key}`, e.target.value)}
                aria-label={`${f.label} weight`}
              />
            </label>
          ))}
        </div>
        {normalized !== null && normalized.sum <= 0 ? (
          <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
            At least one weight must be greater than zero.
          </span>
        ) : null}
      </fieldset>

      {/* Cadence intervals */}
      <fieldset className="flex flex-col gap-2">
        <legend style={TYPE.bodyStrong}>Expected days between meetings (by cadence)</legend>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Drives cadence adherence. A client is “on cadence” when their last meeting is within this window.
          Ad-hoc clients have no expectation, so they’re not scored on cadence.
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          {CADENCE_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{f.label}</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                className={inputClass}
                style={inputStyle}
                value={values[`cadence.${f.key}`]}
                disabled={saving}
                onChange={(e): void => set(`cadence.${f.key}`, e.target.value)}
                aria-label={`${f.label} interval days`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {/* Thresholds & params */}
      <fieldset className="flex flex-col gap-2">
        <legend style={TYPE.bodyStrong}>Thresholds &amp; penalties</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SCALAR_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{f.label}</span>
              <input
                type="number"
                min={0}
                step={f.integer ? 1 : 'any'}
                inputMode={f.integer ? 'numeric' : 'decimal'}
                className={inputClass}
                style={inputStyle}
                value={values[f.key]}
                disabled={saving}
                onChange={(e): void => set(f.key, e.target.value)}
                aria-label={f.label}
              />
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{f.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save & recompute'}
        </Button>
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={saving}
          className="inline-flex items-center gap-1.5"
          style={{ ...TYPE.label, color: 'var(--text-secondary)', cursor: saving ? 'default' : 'pointer' }}
        >
          <RefreshCw size={14} aria-hidden="true" /> Load defaults
        </button>
        {message !== null ? (
          <span
            role={message.ok ? undefined : 'alert'}
            style={{ ...TYPE.secondary, color: message.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
