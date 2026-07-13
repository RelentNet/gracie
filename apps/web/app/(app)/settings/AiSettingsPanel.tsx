'use client';

/**
 * AI model settings (Settings → AI Model, P9). Admin-only. Selects the
 * generation/chat model from a curated list; changes apply to the next request
 * (no redeploy). The embedding model is PINNED (D9) and shown read-only — changing
 * it would invalidate every stored vector, so it can't be changed here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface AiSettings {
  readonly model: string;
  readonly allowedModels: readonly string[];
  readonly defaultModel: string;
  readonly embeddingModel: string;
}
interface SettingsResponse {
  readonly settings: AiSettings;
}

const selectClass = 'w-full max-w-md rounded-lg border bg-white px-3 py-2';
const selectStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

export function AiSettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<SettingsResponse>('/api/settings/ai')
      .then((d) => {
        if (active) setSettings(d.settings);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load AI settings');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const onSelect = useCallback(
    (model: string): void => {
      setSettings((prev) => {
        if (prev === null) return prev;
        const revert = prev;
        setSaving(true);
        setNote(null);
        apiClient
          .patch<SettingsResponse>('/api/settings/ai', { model })
          .then((d) => {
            setSettings(d.settings);
            setNote({ text: 'Saved. New chats and generation use this model.', ok: true });
          })
          .catch((e: unknown) => {
            setSettings(revert);
            setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
          })
          .finally(() => setSaving(false));
        return { ...prev, model };
      });
    },
    [],
  );

  if (loadError !== null) return <ErrorState title="Couldn’t load AI settings" description={loadError} />;
  if (settings === null) return <LoadingState label="Loading AI settings…" />;

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Generation &amp; chat model</span>
        <select
          className={selectClass}
          style={selectStyle}
          value={settings.model}
          disabled={saving}
          onChange={(e): void => onSelect(e.target.value)}
          aria-label="Generation and chat model"
        >
          {settings.allowedModels.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === settings.defaultModel ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Used for meeting-note generation and the Assistant. Applies to the next request — no redeploy.
        </span>
      </label>

      {/* Pinned embedding model — read-only */}
      <div
        className="flex items-start gap-2 rounded-lg border p-3"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}
      >
        <Lock size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
        <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
          <strong>Embedding model is pinned:</strong>{' '}
          <span className="font-data">{settings.embeddingModel}</span>. It’s fixed on purpose — changing it
          would invalidate every stored document vector and require a full re-index, so it can’t be changed here.
        </span>
      </div>

      {note !== null ? (
        <span
          role={note.ok ? undefined : 'alert'}
          style={{ ...TYPE.label, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
        >
          {note.text}
        </span>
      ) : null}
    </div>
  );
}
