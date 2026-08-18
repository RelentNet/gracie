'use client';

/**
 * AI settings (Settings → AI). Admin-only. Picks the generation PROVIDER ("Company"),
 * the MODEL for that provider (with a rough per-hour cost estimate), and the provider's
 * API key. Saving writes all three; changes apply to the next request (no redeploy).
 * The embedding model is PINNED to OpenAI (D9) and shown read-only — an OpenAI key is
 * required for embeddings even when generation runs on another provider.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface ModelOption {
  readonly model: string;
  readonly label: string;
  readonly supportsTools: boolean;
  readonly supportsJson: boolean;
  readonly centsPerMeetingHour: number;
}
interface ProviderOption {
  readonly providerId: string;
  readonly label: string;
  readonly keyIsSet: boolean;
  readonly models: readonly ModelOption[];
}
interface AiSettings {
  readonly provider: string;
  readonly model: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly embeddingModel: string;
  readonly embeddingProvider: string;
  readonly providers: readonly ProviderOption[];
}
interface SettingsResponse {
  readonly settings: AiSettings;
}

const selectClass = 'w-full max-w-md rounded-lg border bg-white px-3 py-2';
const selectStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

/** "~6¢/hr" style estimate; sub-cent models keep one decimal. */
function formatCents(cents: number): string {
  const rounded = cents >= 1 ? Math.round(cents * 10) / 10 : Math.round(cents * 100) / 100;
  return `~${rounded}¢ per hour of meetings`;
}

export function AiSettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<SettingsResponse>('/api/settings/ai')
      .then((d) => {
        if (!active) return;
        setSettings(d.settings);
        setProvider(d.settings.provider);
        setModel(d.settings.model);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load AI settings');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const currentProvider = useMemo(
    () => settings?.providers.find((p) => p.providerId === provider) ?? null,
    [settings, provider],
  );
  const currentModel = useMemo(
    () => currentProvider?.models.find((m) => m.model === model) ?? null,
    [currentProvider, model],
  );
  const openaiKeySet = useMemo(
    () => settings?.providers.find((p) => p.providerId === 'openai')?.keyIsSet ?? false,
    [settings],
  );

  // Switching provider resets the model to that provider's first option (keeps a valid pair).
  const onProviderChange = useCallback(
    (next: string): void => {
      setProvider(next);
      setApiKey('');
      setNote(null);
      setSettings((prev) => {
        const models = prev?.providers.find((p) => p.providerId === next)?.models ?? [];
        setModel(models[0]?.model ?? '');
        return prev;
      });
    },
    [],
  );

  const onSave = useCallback((): void => {
    setSaving(true);
    setNote(null);
    apiClient
      .patch<SettingsResponse>('/api/settings/ai', { provider, model, apiKey: apiKey.trim() === '' ? undefined : apiKey })
      .then((d) => {
        setSettings(d.settings);
        setProvider(d.settings.provider);
        setModel(d.settings.model);
        setApiKey('');
        setNote({ text: 'Saved. New chats and generation use this provider and model.', ok: true });
      })
      .catch((e: unknown) => {
        setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
      })
      .finally(() => setSaving(false));
  }, [provider, model, apiKey]);

  if (loadError !== null) return <ErrorState title="Couldn’t load AI settings" description={loadError} />;
  if (settings === null || currentProvider === null) return <LoadingState label="Loading AI settings…" />;

  const dirty = provider !== settings.provider || model !== settings.model || apiKey.trim() !== '';
  const providerNeedsKey = !currentProvider.keyIsSet && apiKey.trim() === '';

  return (
    <div className="flex flex-col gap-6">
      {/* Provider ("Company") */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Provider</span>
        <select
          className={selectClass}
          style={selectStyle}
          value={provider}
          disabled={saving}
          onChange={(e): void => onProviderChange(e.target.value)}
          aria-label="AI provider"
        >
          {settings.providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.label}
              {p.providerId === settings.defaultProvider ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Model */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Generation &amp; chat model</span>
        <select
          className={selectClass}
          style={selectStyle}
          value={model}
          disabled={saving}
          onChange={(e): void => setModel(e.target.value)}
          aria-label="Generation and chat model"
        >
          {currentProvider.models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label} — {formatCents(m.centsPerMeetingHour)}
            </option>
          ))}
        </select>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Used for meeting-note generation and the Assistant. Applies to the next request — no redeploy.
          {currentModel !== null ? ` Estimated cost: ${formatCents(currentModel.centsPerMeetingHour)} (rough).` : ''}
        </span>
      </label>

      {/* API key for the selected provider */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{currentProvider.label} API key</span>
        <input
          type="password"
          className={selectClass}
          style={selectStyle}
          value={apiKey}
          disabled={saving}
          autoComplete="off"
          placeholder={currentProvider.keyIsSet ? 'Key on file — leave blank to keep it' : 'No key set — required for this provider'}
          onChange={(e): void => setApiKey(e.target.value)}
          aria-label={`${currentProvider.label} API key`}
        />
        {providerNeedsKey ? (
          <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
            No {currentProvider.label} key is set — generation will fail until one is entered.
          </span>
        ) : null}
      </label>

      {/* Pinned embedding model — read-only, + OpenAI-key-for-embeddings note */}
      <div
        className="flex items-start gap-2 rounded-lg border p-3"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}
      >
        <Lock size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
        <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
          <strong>Embeddings always use OpenAI:</strong>{' '}
          <span className="font-data">{settings.embeddingModel}</span>. It’s pinned on purpose — changing it
          would invalidate every stored document vector and require a full re-index. An OpenAI API key is
          required for embeddings <em>even when generation runs on another provider</em>.
          {!openaiKeySet ? ' No OpenAI key is currently set — embeddings will fail until one is added (select OpenAI above to set it).' : ''}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={saving || !dirty || model === ''} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {note !== null ? (
          <span
            role={note.ok ? undefined : 'alert'}
            style={{ ...TYPE.label, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
          >
            {note.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
