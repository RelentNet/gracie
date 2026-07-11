'use client';

/**
 * Notifications & Communication settings (Settings → Notifications). Admin-only.
 * Toggles which of Gracie's INTERNAL emails go out; each toggle auto-saves. The
 * `@graceandassociates.com` allowlist is shown READ-ONLY — Gracie never emails
 * customers, and widening the allowlist is an escalation-only change, not a UI one.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface NotificationSettings {
  readonly dailySyncEnabled: boolean;
  readonly briefsEnabled: boolean;
  readonly alerts: {
    readonly pipelineFailed: boolean;
    readonly needsAttention: boolean;
    readonly calendarDisconnect: boolean;
    readonly kbExpiring: boolean;
  };
  readonly allowedDomains: readonly string[];
}
interface SettingsResponse {
  readonly settings: NotificationSettings;
}
interface PatchBody {
  dailySyncEnabled?: boolean;
  briefsEnabled?: boolean;
  alerts?: Partial<NotificationSettings['alerts']>;
}

export function NotificationSettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<SettingsResponse>('/api/settings/notifications')
      .then((d) => {
        if (active) setSettings(d.settings);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load notification settings');
      });
    return (): void => {
      active = false;
    };
  }, []);

  /** Optimistically apply, PATCH the single field, reconcile / revert on error. */
  const save = useCallback(
    (key: string, optimistic: NotificationSettings, patch: PatchBody): void => {
      setSettings((prev) => {
        const revert = prev;
        setSavingKey(key);
        setNote(null);
        apiClient
          .patch<SettingsResponse>('/api/settings/notifications', patch)
          .then((d) => setSettings(d.settings))
          .catch((e: unknown) => {
            setSettings(revert);
            setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
          })
          .finally(() => setSavingKey(null));
        return optimistic;
      });
    },
    [],
  );

  if (loadError !== null) return <ErrorState title="Couldn’t load notification settings" description={loadError} />;
  if (settings === null) return <LoadingState label="Loading notification settings…" />;

  const busy = savingKey !== null;
  const setAlert = (
    field: keyof NotificationSettings['alerts'],
    label: string,
    value: boolean,
  ): void =>
    save(
      `alert.${field}`,
      { ...settings, alerts: { ...settings.alerts, [field]: value } },
      { alerts: { [field]: value } },
    );

  return (
    <div className="flex flex-col gap-6">
      {/* Team digests */}
      <fieldset className="flex flex-col gap-3">
        <legend style={TYPE.bodyStrong}>Team digests</legend>
        <Row
          label="Daily sync email"
          description="The morning digest emailed to the team."
          checked={settings.dailySyncEnabled}
          disabled={busy}
          onChange={(v): void =>
            save('dailySyncEnabled', { ...settings, dailySyncEnabled: v }, { dailySyncEnabled: v })
          }
        />
        <Row
          label="Pre-meeting briefs"
          description="Per-meeting briefs bundled into the daily sync email."
          checked={settings.briefsEnabled}
          disabled={busy || !settings.dailySyncEnabled}
          onChange={(v): void =>
            save('briefsEnabled', { ...settings, briefsEnabled: v }, { briefsEnabled: v })
          }
        />
      </fieldset>

      {/* Admin alert emails */}
      <fieldset className="flex flex-col gap-3">
        <legend style={TYPE.bodyStrong}>Admin alert emails</legend>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Emails sent to admins when something needs attention. Turning one off stops the email only —
          the in-app notification still appears.
        </span>
        <Row
          label="Pipeline failure"
          description="A meeting’s notes/docs failed to generate."
          checked={settings.alerts.pipelineFailed}
          disabled={busy}
          onChange={(v): void => setAlert('pipelineFailed', 'Pipeline failure', v)}
        />
        <Row
          label="Transcript overdue"
          description="A recorded meeting’s transcript never arrived."
          checked={settings.alerts.needsAttention}
          disabled={busy}
          onChange={(v): void => setAlert('needsAttention', 'Transcript overdue', v)}
        />
        <Row
          label="Calendar disconnected"
          description="A team member’s calendar connection dropped."
          checked={settings.alerts.calendarDisconnect}
          disabled={busy}
          onChange={(v): void => setAlert('calendarDisconnect', 'Calendar disconnected', v)}
        />
        <Row
          label="Knowledge base doc expiring"
          description="A KB document is approaching its expiration date."
          checked={settings.alerts.kbExpiring}
          disabled={busy}
          onChange={(v): void => setAlert('kbExpiring', 'KB doc expiring', v)}
        />
      </fieldset>

      {/* Read-only allowlist */}
      <div
        className="flex items-start gap-2 rounded-lg border p-3"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}
      >
        <ShieldCheck size={16} aria-hidden="true" style={{ color: 'var(--color-emerald-600)', marginTop: 2 }} />
        <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
          <strong>Gracie only ever emails:</strong>{' '}
          <span className="font-data">{settings.allowedDomains.join(', ')}</span>. She never contacts
          your clients or customers by email. This allowlist is fixed here on purpose — widening it is a
          deliberate, escalation-only change.
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

/** One labelled auto-saving toggle row. */
function Row({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex flex-col gap-0.5">
        <span style={TYPE.body}>{label}</span>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{description}</span>
      </span>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} label="" ariaLabel={label} />
    </div>
  );
}
