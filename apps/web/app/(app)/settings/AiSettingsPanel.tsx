'use client';

/**
 * AI settings (Settings → AI Provider). Admin-only. The SINGLE place for all AI keys.
 * Picks the generation PROVIDER (OpenAI, Anthropic, Google, Mistral, Groq, DeepSeek,
 * xAI, Cohere, Perplexity, Ollama-local, or a Custom OpenAI-compatible endpoint), the
 * MODEL (a preset OR any free-text model id), and the provider's API key. Ollama/Custom
 * also take a base URL. Saving applies to the next request (no redeploy).
 *
 * Embeddings/search are PINNED to OpenAI (D9), so an OpenAI key is ALWAYS required even
 * when generation runs elsewhere — surfaced as a separate always-present field. When the
 * generation provider IS OpenAI, the one key covers both (no duplicate field).
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
  readonly needsBaseUrl: boolean;
  readonly defaultBaseUrl: string | null;
  readonly models: readonly ModelOption[];
}
interface AiSettings {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly embeddingModel: string;
  readonly embeddingProvider: string;
  readonly openaiKeyIsSet: boolean;
  readonly providers: readonly ProviderOption[];
}
interface SettingsResponse {
  readonly settings: AiSettings;
}

/** Sentinel value for the "Custom model…" option in the model dropdown. */
const CUSTOM_MODEL = '__custom__';

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
  const [customMode, setCustomMode] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
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
        setBaseUrl(d.settings.baseUrl);
        const cp = d.settings.providers.find((p) => p.providerId === d.settings.provider);
        // Custom mode when the stored model isn't one of the provider's presets.
        setCustomMode(!(cp?.models.some((m) => m.model === d.settings.model) ?? false));
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
  const presetModel = useMemo(
    () => currentProvider?.models.find((m) => m.model === model) ?? null,
    [currentProvider, model],
  );

  // Switching provider resets the model to that provider's first preset (or free-text
  // when it has none, e.g. Ollama/Custom) and prefills the base URL (Ollama's default).
  const onProviderChange = useCallback(
    (next: string): void => {
      setProvider(next);
      setApiKey('');
      setOpenaiKey('');
      setNote(null);
      setSettings((prev) => {
        const p = prev?.providers.find((x) => x.providerId === next) ?? null;
        const first = p?.models[0]?.model ?? '';
        setModel(first);
        setCustomMode(first === '');
        setBaseUrl(p?.defaultBaseUrl ?? '');
        return prev;
      });
    },
    [],
  );

  const onModelSelect = useCallback((value: string): void => {
    if (value === CUSTOM_MODEL) {
      setCustomMode(true);
    } else {
      setCustomMode(false);
      setModel(value);
    }
  }, []);

  const onSave = useCallback((): void => {
    setSaving(true);
    setNote(null);
    const needsBaseUrl = currentProvider?.needsBaseUrl ?? false;
    apiClient
      .patch<SettingsResponse>('/api/settings/ai', {
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() === '' ? undefined : apiKey.trim(),
        baseUrl: needsBaseUrl ? baseUrl.trim() : undefined,
        openaiKey: provider !== 'openai' && openaiKey.trim() !== '' ? openaiKey.trim() : undefined,
      })
      .then((d) => {
        setSettings(d.settings);
        setProvider(d.settings.provider);
        setModel(d.settings.model);
        setBaseUrl(d.settings.baseUrl);
        const cp = d.settings.providers.find((p) => p.providerId === d.settings.provider);
        setCustomMode(!(cp?.models.some((m) => m.model === d.settings.model) ?? false));
        setApiKey('');
        setOpenaiKey('');
        setNote({ text: 'Saved. New chats and generation use this provider and model.', ok: true });
      })
      .catch((e: unknown) => {
        setNote({ text: e instanceof Error ? e.message : 'Could not save.', ok: false });
      })
      .finally(() => setSaving(false));
  }, [provider, model, apiKey, baseUrl, openaiKey, currentProvider]);

  if (loadError !== null) return <ErrorState title="Couldn’t load AI settings" description={loadError} />;
  if (settings === null || currentProvider === null) return <LoadingState label="Loading AI settings…" />;

  const needsBaseUrl = currentProvider.needsBaseUrl;
  const modelDirty = model !== settings.model;
  const baseUrlDirty = needsBaseUrl && baseUrl !== settings.baseUrl;
  const dirty =
    provider !== settings.provider ||
    modelDirty ||
    baseUrlDirty ||
    apiKey.trim() !== '' ||
    openaiKey.trim() !== '';
  const providerNeedsKey = !currentProvider.keyIsSet && apiKey.trim() === '' && !needsBaseUrl;
  const baseUrlMissing = needsBaseUrl && baseUrl.trim() === '';
  const modelMissing = model.trim() === '';
  // Selected value for the model <select>: a matching preset, else the Custom sentinel.
  const modelSelectValue = customMode || presetModel === null ? CUSTOM_MODEL : model;
  const showModelText = customMode || currentProvider.models.length === 0;
  // OpenAI-for-embeddings key is a separate field only when generation is NOT OpenAI.
  const showEmbeddingKeyField = provider !== 'openai';

  return (
    <div className="flex flex-col gap-6">
      {/* Provider */}
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

      {/* Base URL (Ollama / Custom OpenAI-compatible) */}
      {needsBaseUrl ? (
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Endpoint (base URL)</span>
          <input
            type="text"
            className={selectClass}
            style={selectStyle}
            value={baseUrl}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            placeholder={currentProvider.defaultBaseUrl ?? 'https://your-endpoint/v1'}
            onChange={(e): void => setBaseUrl(e.target.value)}
            aria-label="Provider base URL"
          />
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            {provider === 'ollama'
              ? 'Your Ollama server’s OpenAI-compatible endpoint. Runs on your own hardware — data never leaves it.'
              : 'Any OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM, LM Studio, Together, Fireworks, …).'}
          </span>
          {baseUrlMissing ? (
            <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
              An endpoint is required for this provider.
            </span>
          ) : null}
        </label>
      ) : null}

      {/* Model — presets + Custom free-text */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Generation &amp; chat model</span>
        {currentProvider.models.length > 0 ? (
          <select
            className={selectClass}
            style={selectStyle}
            value={modelSelectValue}
            disabled={saving}
            onChange={(e): void => onModelSelect(e.target.value)}
            aria-label="Generation and chat model"
          >
            {currentProvider.models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.label} — {formatCents(m.centsPerMeetingHour)}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>Custom model…</option>
          </select>
        ) : null}
        {showModelText ? (
          <input
            type="text"
            className={selectClass}
            style={selectStyle}
            value={model}
            disabled={saving}
            autoComplete="off"
            spellCheck={false}
            placeholder={provider === 'ollama' ? 'e.g. llama3.1' : 'Enter a model id'}
            onChange={(e): void => setModel(e.target.value)}
            aria-label="Custom model id"
          />
        ) : null}
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Used for meeting-note generation and the Assistant. Applies to the next request — no redeploy.{' '}
          {presetModel !== null
            ? `Estimated cost: ${formatCents(presetModel.centsPerMeetingHour)} (rough).`
            : 'Cost varies — depends on the model you enter.'}
        </span>
      </label>

      {/* API key for the selected provider */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          {currentProvider.label} API key{needsBaseUrl && provider === 'ollama' ? ' (optional)' : ''}
        </span>
        <input
          type="password"
          className={selectClass}
          style={selectStyle}
          value={apiKey}
          disabled={saving}
          autoComplete="off"
          placeholder={
            currentProvider.keyIsSet
              ? 'Key on file — leave blank to keep it'
              : needsBaseUrl && provider === 'ollama'
                ? 'No key needed for a local Ollama server'
                : 'No key set — required for this provider'
          }
          onChange={(e): void => setApiKey(e.target.value)}
          aria-label={`${currentProvider.label} API key`}
        />
        {providerNeedsKey ? (
          <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
            No {currentProvider.label} key is set — generation will fail until one is entered.
          </span>
        ) : null}
      </label>

      {/* OpenAI key for search/embeddings — separate field when generation is on another provider */}
      {showEmbeddingKeyField ? (
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            OpenAI API key — required for search/embeddings
          </span>
          <input
            type="password"
            className={selectClass}
            style={selectStyle}
            value={openaiKey}
            disabled={saving}
            autoComplete="off"
            placeholder={settings.openaiKeyIsSet ? 'Key on file — leave blank to keep it' : 'No key set — required for search/embeddings'}
            onChange={(e): void => setOpenaiKey(e.target.value)}
            aria-label="OpenAI API key for search and embeddings"
          />
          {!settings.openaiKeyIsSet && openaiKey.trim() === '' ? (
            <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
              No OpenAI key is set — search and embeddings will fail until one is entered (this is separate from your
              generation provider’s key).
            </span>
          ) : (
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              Kept even when generation runs on {currentProvider.label}, because embeddings are always OpenAI.
            </span>
          )}
        </label>
      ) : null}

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
          required for embeddings <em>even when generation runs on another provider</em>
          {provider === 'openai' ? ' — the OpenAI key above covers both.' : '.'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={saving || !dirty || modelMissing || baseUrlMissing} onClick={onSave}>
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
