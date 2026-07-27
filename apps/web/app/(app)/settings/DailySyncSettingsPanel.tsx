'use client';

/**
 * Daily Sync settings (Settings → Daily Sync, DS). Admin-only. Owns everything about
 * the morning digest email: the schedule/scope controls (moved here out of
 * Notifications), the editable email-body TEMPLATE (text + shortcodes over a fixed
 * HTML shell), and the optional AI briefing (`{ai_brief}` — off by default, composed
 * only from your own data). "Send test email to me" renders the email with the saved
 * settings and delivers it to just you, so you can see it before 6 AM.
 *
 * Toggles + numbers auto-save; the template + AI prompt save together via one button.
 * Reset-to-default restores a field's default text (Save persists it). A blank field
 * falls back to the default, so nothing can end up empty.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw, Send } from 'lucide-react';

import { DAILY_SYNC_SHORTCODES } from '@gracie/shared';

import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface EditableText {
  readonly default: string;
  readonly effective: string;
  readonly isOverridden: boolean;
}
interface DailySyncSettings {
  readonly template: EditableText;
  readonly aiPrompt: EditableText;
  readonly aiEnabled: boolean;
}
interface NotifSubset {
  readonly dailySyncEnabled: boolean;
  readonly briefsEnabled: boolean;
  readonly timing: { readonly dailySyncHourEt: number; readonly atRiskHealthThreshold: number };
}

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;
const numClass = 'w-24 rounded-lg border bg-white px-3 py-2';

export function DailySyncSettingsPanel(): React.JSX.Element {
  const [ds, setDs] = useState<DailySyncSettings | null>(null);
  const [notif, setNotif] = useState<NotifSubset | null>(null);
  const [templateText, setTemplateText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [hourStr, setHourStr] = useState('');
  const [thresholdStr, setThresholdStr] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const hydrateDs = useCallback((s: DailySyncSettings): void => {
    setDs(s);
    setTemplateText(s.template.effective);
    setPromptText(s.aiPrompt.effective);
  }, []);
  const hydrateNotif = useCallback((s: NotifSubset): void => {
    setNotif(s);
    setHourStr(String(s.timing.dailySyncHourEt));
    setThresholdStr(String(s.timing.atRiskHealthThreshold));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<{ settings: DailySyncSettings }>('/api/settings/daily-sync'),
      apiClient.get<{ settings: NotifSubset }>('/api/settings/notifications'),
    ])
      .then(([a, b]) => {
        if (!active) return;
        hydrateDs(a.settings);
        hydrateNotif(b.settings);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load daily-sync settings');
      });
    return (): void => {
      active = false;
    };
  }, [hydrateDs, hydrateNotif]);

  /** Auto-save a Notifications patch (the 4 consolidated controls live on that endpoint). */
  const saveNotif = useCallback(
    (key: string, patch: Record<string, unknown>): void => {
      setBusyKey(key);
      setNote(null);
      apiClient
        .patch<{ settings: NotifSubset }>('/api/settings/notifications', patch)
        .then((d) => hydrateNotif(d.settings))
        .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false }))
        .finally(() => setBusyKey(null));
    },
    [hydrateNotif],
  );

  /** Auto-save the AI on/off switch (daily-sync endpoint). */
  const saveAiEnabled = useCallback(
    (aiEnabled: boolean): void => {
      setBusyKey('aiEnabled');
      setNote(null);
      apiClient
        .patch<{ settings: DailySyncSettings }>('/api/settings/daily-sync', { aiEnabled })
        .then((d) => setDs(d.settings))
        .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false }))
        .finally(() => setBusyKey(null));
    },
    [],
  );

  const saveTemplateAndPrompt = useCallback((): Promise<void> => {
    return apiClient
      .patch<{ settings: DailySyncSettings }>('/api/settings/daily-sync', {
        template: templateText,
        aiPrompt: promptText,
      })
      .then((d) => hydrateDs(d.settings));
  }, [templateText, promptText, hydrateDs]);

  const onSave = useCallback((): void => {
    setSaving(true);
    setNote(null);
    saveTemplateAndPrompt()
      .then(() => setNote({ text: 'Saved.', ok: true }))
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Save failed.', ok: false }))
      .finally(() => setSaving(false));
  }, [saveTemplateAndPrompt]);

  /** Save the current template + prompt, then email a preview to just this admin. */
  const onSendTest = useCallback((): void => {
    setTesting(true);
    setNote(null);
    saveTemplateAndPrompt()
      .then(async () => {
        const res = await fetch('/api/daily-sync/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preview: true }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(data.error?.message ?? `Request failed (${res.status})`);
        }
        setNote({ text: 'Test sent — check your inbox in a moment.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Could not send the test.', ok: false }))
      .finally(() => setTesting(false));
  }, [saveTemplateAndPrompt]);

  if (loadError !== null) return <ErrorState title="Couldn’t load daily-sync settings" description={loadError} />;
  if (ds === null || notif === null) return <LoadingState label="Loading daily-sync settings…" />;

  const busy = busyKey !== null;
  const templateHasAiShortcode = templateText.includes('{ai_brief}');

  // `notif` is non-null past the guard above — safe to read `notif.timing` here.
  const commitNumber = (
    key: string,
    raw: string,
    min: number,
    max: number,
    build: (n: number) => Record<string, unknown>,
    current: number,
  ): void => {
    const n = Number(raw.trim());
    if (raw.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
      setNote({ text: `Enter a whole number between ${min} and ${max}.`, ok: false });
      setHourStr(String(notif.timing.dailySyncHourEt));
      setThresholdStr(String(notif.timing.atRiskHealthThreshold));
      return;
    }
    if (n === current) return;
    saveNotif(key, build(n));
  };

  return (
    <div className="flex flex-col gap-8">
      {/* 1 — Schedule & scope (consolidated from Notifications) */}
      <fieldset className="flex flex-col gap-3">
        <legend style={TYPE.bodyStrong}>Schedule &amp; scope</legend>
        <Row
          label="Daily sync email"
          description="The morning digest emailed to the team."
          checked={notif.dailySyncEnabled}
          disabled={busy}
          onChange={(v): void => {
            setNotif({ ...notif, dailySyncEnabled: v });
            saveNotif('dailySyncEnabled', { dailySyncEnabled: v });
          }}
        />
        <Row
          label="Pre-meeting briefs"
          description="Per-meeting briefs bundled into the daily sync."
          checked={notif.briefsEnabled}
          disabled={busy || !notif.dailySyncEnabled}
          onChange={(v): void => {
            setNotif({ ...notif, briefsEnabled: v });
            saveNotif('briefsEnabled', { briefsEnabled: v });
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Send hour (ET)</span>
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              inputMode="numeric"
              className={numClass}
              style={inputStyle}
              value={hourStr}
              disabled={busy}
              onChange={(e): void => setHourStr(e.target.value)}
              onBlur={(): void =>
                commitNumber('dailySyncHourEt', hourStr, 0, 23, (n) => ({ timing: { dailySyncHourEt: n } }), notif.timing.dailySyncHourEt)
              }
              aria-label="Send hour (ET)"
            />
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>The hour (0–23, Eastern) the digest goes out.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>At-risk health threshold</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              className={numClass}
              style={inputStyle}
              value={thresholdStr}
              disabled={busy}
              onChange={(e): void => setThresholdStr(e.target.value)}
              onBlur={(): void =>
                commitNumber(
                  'atRiskHealthThreshold',
                  thresholdStr,
                  0,
                  100,
                  (n) => ({ timing: { atRiskHealthThreshold: n } }),
                  notif.timing.atRiskHealthThreshold,
                )
              }
              aria-label="At-risk health threshold"
            />
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Clients at/below this score are flagged “at risk”.</span>
          </label>
        </div>
      </fieldset>

      {/* 2 — Email template */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span style={TYPE.bodyStrong}>Email template</span>
          <button
            type="button"
            onClick={(): void => {
              setTemplateText(ds.template.default);
              setNote(null);
            }}
            disabled={saving || templateText.trim() === ds.template.default.trim()}
            aria-label="Reset template to default"
            className="inline-flex items-center gap-1"
            style={{
              ...TYPE.label,
              color: templateText.trim() === ds.template.default.trim() ? 'var(--text-secondary)' : 'var(--color-blue-700)',
              opacity: templateText.trim() === ds.template.default.trim() ? 0.6 : 1,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset to default
          </button>
        </div>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          The body of the morning email. Write text and drop in <span className="font-data">{'{shortcodes}'}</span> — the
          fixed header/footer styling is applied automatically.
        </span>
        <textarea
          className={inputClass}
          style={{ ...inputStyle, minHeight: 160, resize: 'vertical', fontFamily: 'var(--font-data, monospace)' }}
          value={templateText}
          maxLength={20000}
          disabled={saving}
          onChange={(e): void => setTemplateText(e.target.value)}
          aria-label="Email template"
        />
        <div className="flex flex-col gap-1 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}>
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Available shortcodes:</span>
          <ul className="grid gap-1 sm:grid-cols-2">
            {DAILY_SYNC_SHORTCODES.map((s) => (
              <li key={s.code} style={{ ...TYPE.label }}>
                <span className="font-data" style={{ color: 'var(--color-blue-700)' }}>{`{${s.code}}`}</span>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>— {s.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 3 — AI briefing */}
      <div className="flex flex-col gap-2">
        <Row
          label="Gracie’s AI briefing"
          description="Compose a narrative from your own data. Off by default."
          checked={ds.aiEnabled}
          disabled={busy}
          onChange={(v): void => {
            setDs({ ...ds, aiEnabled: v });
            saveAiEnabled(v);
          }}
        />
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          When on, add the <span className="font-data">{'{ai_brief}'}</span> shortcode to your template where you want it.
          Composed <strong>only</strong> from your own meeting data — Gracie never uses outside information here.
        </span>
        {ds.aiEnabled && !templateHasAiShortcode ? (
          <span
            className="inline-flex items-start gap-1.5 rounded-md px-2 py-1"
            style={{ ...TYPE.label, color: 'var(--color-amber-600)', backgroundColor: 'var(--color-amber-100)' }}
          >
            <AlertTriangle size={13} aria-hidden="true" style={{ marginTop: 1, flexShrink: 0 }} />
            The AI briefing is on, but your template doesn’t include <span className="font-data">{'{ai_brief}'}</span> — add
            it above to show the narrative.
          </span>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>AI prompt</span>
          <button
            type="button"
            onClick={(): void => {
              setPromptText(ds.aiPrompt.default);
              setNote(null);
            }}
            disabled={saving || promptText.trim() === ds.aiPrompt.default.trim()}
            aria-label="Reset AI prompt to default"
            className="inline-flex items-center gap-1"
            style={{
              ...TYPE.label,
              color: promptText.trim() === ds.aiPrompt.default.trim() ? 'var(--text-secondary)' : 'var(--color-blue-700)',
              opacity: promptText.trim() === ds.aiPrompt.default.trim() ? 0.6 : 1,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset to default
          </button>
        </div>
        <textarea
          className={inputClass}
          style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
          value={promptText}
          maxLength={20000}
          disabled={saving}
          onChange={(e): void => setPromptText(e.target.value)}
          aria-label="AI prompt"
        />
      </div>

      {/* 4 — Save + test */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onSave} disabled={saving || testing}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          variant="secondary"
          icon={<Send size={14} aria-hidden="true" />}
          onClick={onSendTest}
          disabled={saving || testing}
        >
          {testing ? 'Sending…' : 'Send test email to me'}
        </Button>
        {note !== null ? (
          <span
            role={note.ok ? undefined : 'alert'}
            style={{ ...TYPE.secondary, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
          >
            {note.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** One labelled auto-saving toggle row (mirrors the Notifications panel). */
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
