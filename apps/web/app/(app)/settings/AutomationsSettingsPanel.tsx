'use client';

/**
 * Automations settings (Settings → Automations). Admin-only. Two controls:
 *  - the customer-contact EXCEPTION master switch: while OFF (the default), NO
 *    automation may email a client/external recipient — Gracie's GA-only email floor
 *    stands for every send. Turning it ON only *permits* external sends that are ALSO
 *    explicitly user-initiated, admin-confirmed, and audited (P8 §2b).
 *  - the recurring-interval floor (P9): the shortest interval a recurring automation
 *    may use (default hourly). Clamped server-side to a structural minimum.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface AutomationsSettings {
  readonly externalSendEnabled: boolean;
  readonly minIntervalMinutes: number;
  readonly minIntervalBounds: { readonly min: number; readonly max: number };
}

const inputClass = 'w-40 rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

export function AutomationsSettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<AutomationsSettings | null>(null);
  const [intervalStr, setIntervalStr] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingInterval, setSavingInterval] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const hydrate = useCallback((s: AutomationsSettings): void => {
    setSettings(s);
    setIntervalStr(String(s.minIntervalMinutes));
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .get<AutomationsSettings>('/api/settings/automations')
      .then((d) => {
        if (active) hydrate(d);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load automation settings');
      });
    return (): void => {
      active = false;
    };
  }, [hydrate]);

  const saveToggle = useCallback(
    (next: boolean): void => {
      setSavingToggle(true);
      setNote(null);
      setSettings((prev) => (prev === null ? prev : { ...prev, externalSendEnabled: next })); // optimistic
      apiClient
        .patch<AutomationsSettings>('/api/settings/automations', { externalSendEnabled: next })
        .then((d) => hydrate(d))
        .catch((e: unknown) => {
          setSettings((prev) => (prev === null ? prev : { ...prev, externalSendEnabled: !next })); // revert
          setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
        })
        .finally(() => setSavingToggle(false));
    },
    [hydrate],
  );

  const saveInterval = useCallback((): void => {
    if (settings === null) return;
    const minutes = Number(intervalStr.trim());
    const { min, max } = settings.minIntervalBounds;
    if (!Number.isFinite(minutes) || minutes < min || minutes > max) {
      setNote({ text: `Interval must be a number between ${min} and ${max} minutes.`, ok: false });
      return;
    }
    setSavingInterval(true);
    setNote(null);
    apiClient
      .patch<AutomationsSettings>('/api/settings/automations', { minIntervalMinutes: Math.round(minutes) })
      .then((d) => {
        hydrate(d);
        setNote({ text: 'Saved.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false }))
      .finally(() => setSavingInterval(false));
  }, [settings, intervalStr, hydrate]);

  if (loadError !== null) return <ErrorState title="Couldn’t load automation settings" description={loadError} />;
  if (settings === null) return <LoadingState label="Loading automation settings…" />;

  const enabled = settings.externalSendEnabled;

  return (
    <div className="flex flex-col gap-6">
      {/* External-send master switch */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span style={TYPE.body}>Allow automations to email clients (external recipients)</span>
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              Off by default. Even when on, an external send still requires a user to have set it up, an
              admin to confirm it explicitly, and it is recorded in the automation’s run log.
            </span>
          </span>
          <ToggleSwitch
            checked={enabled}
            onChange={saveToggle}
            disabled={savingToggle}
            label=""
            ariaLabel="Allow automations to email external recipients"
          />
        </div>

        <div
          className="flex items-start gap-2 rounded-lg border p-3"
          style={{
            borderColor: enabled ? 'var(--color-amber-300, #fcd34d)' : 'var(--border-subtle)',
            backgroundColor: enabled ? 'var(--color-amber-50, #fffbeb)' : 'var(--color-slate-100)',
          }}
        >
          <ShieldAlert size={16} aria-hidden="true" style={{ color: 'var(--color-amber-700, #b45309)', marginTop: 2 }} />
          <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
            {enabled ? (
              <>
                <strong>External sending is ON.</strong> Gracie can email approved external recipients when an
                admin confirms it. Every internal (team) email still goes only to your own domain.
              </>
            ) : (
              <>
                <strong>External sending is OFF.</strong> Gracie only ever emails your own team
                (<span className="font-data">@graceandassociates.com</span>). No automation can reach a client
                by email while this is off.
              </>
            )}
          </span>
        </div>
      </div>

      {/* Recurring-interval floor */}
      <fieldset className="flex flex-col gap-2">
        <legend style={TYPE.bodyStrong}>Recurring-interval floor</legend>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          The shortest interval a recurring automation may use, in minutes. Default 60 (hourly). The
          minimum is {settings.minIntervalBounds.min} minutes — automations can never run more often than this.
        </span>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={settings.minIntervalBounds.min}
            max={settings.minIntervalBounds.max}
            step={1}
            inputMode="numeric"
            className={inputClass}
            style={inputStyle}
            value={intervalStr}
            disabled={savingInterval}
            onChange={(e): void => setIntervalStr(e.target.value)}
            aria-label="Minimum minutes between recurring automation runs"
          />
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>minutes</span>
          <Button variant="secondary" onClick={saveInterval} disabled={savingInterval}>
            {savingInterval ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </fieldset>

      {note !== null ? (
        <span role={note.ok ? undefined : 'alert'} style={{ ...TYPE.label, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}>
          {note.text}
        </span>
      ) : null}
    </div>
  );
}
