'use client';

/**
 * Automations settings (Settings → Automations). Admin-only. The single control
 * here is the customer-contact EXCEPTION master switch: while OFF (the default),
 * NO automation may email a client/external recipient — Gracie's GA-only email
 * floor stands for every send. Turning it ON only *permits* external sends that are
 * ALSO explicitly user-initiated, admin-confirmed, and audited (P8 §2b).
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface SettingsResponse {
  readonly externalSendEnabled: boolean;
}

export function AutomationsSettingsPanel(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<SettingsResponse>('/api/settings/automations')
      .then((d) => {
        if (active) setEnabled(d.externalSendEnabled);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load automation settings');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const save = useCallback((next: boolean): void => {
    setSaving(true);
    setNote(null);
    setEnabled(next); // optimistic
    apiClient
      .patch<SettingsResponse>('/api/settings/automations', { externalSendEnabled: next })
      .then((d) => setEnabled(d.externalSendEnabled))
      .catch((e: unknown) => {
        setEnabled(!next); // revert
        setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
      })
      .finally(() => setSaving(false));
  }, []);

  if (loadError !== null) return <ErrorState title="Couldn’t load automation settings" description={loadError} />;
  if (enabled === null) return <LoadingState label="Loading automation settings…" />;

  return (
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
          onChange={save}
          disabled={saving}
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

      {note !== null ? (
        <span role={note.ok ? undefined : 'alert'} style={{ ...TYPE.label, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}>
          {note.text}
        </span>
      ) : null}
    </div>
  );
}
