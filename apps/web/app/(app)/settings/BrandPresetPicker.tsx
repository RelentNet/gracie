'use client';

/**
 * Brand identity picker (Settings → Company → Branding). Admin-only surface for
 * choosing a white-label preset — product name plus palette — and, optionally,
 * overriding just the name.
 *
 * Applying calls PUT /api/settings/branding then `refresh()`, which re-fetches the
 * app bootstrap: the new palette replaces the brand `<style>` block and the new name
 * arrives through `AuthProvider` (see src/main.tsx).
 */
import { useCallback, useState } from 'react';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { BRAND_PRESETS } from '@/lib/brand-presets';
import { useRefresh } from '@/lib/refresh';
import { TYPE } from '@/lib/typography';

interface BrandingResponse {
  readonly presetId: string;
  readonly productName: string;
  readonly productNameOverride: string | null;
}

export function BrandPresetPicker(): React.JSX.Element {
  const { refresh } = useRefresh();
  const { brandPresetId, productName } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  // Starts empty: the placeholder shows the name in force, so an empty field
  // reads as "unchanged" and submitting empty clears any override.
  const [nameDraft, setNameDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (body: { presetId?: string; productName?: string }, busyKey: string) => {
      setPending(busyKey);
      setError(null);
      try {
        await apiClient.put<BrandingResponse>('/api/settings/branding', body);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not apply branding');
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Brand identity</span>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Choose how the product presents itself. This changes the name in the navigation, the
          browser tab, and the name the meeting assistant uses when it joins a call.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BRAND_PRESETS.map((preset) => {
          const selected = preset.id === brandPresetId;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => void apply({ presetId: preset.id }, preset.id)}
              disabled={pending !== null}
              aria-pressed={selected}
              className="flex items-center gap-3 rounded-lg border p-3 text-left transition-opacity disabled:opacity-60"
              style={{
                borderColor: selected ? 'var(--brand)' : 'var(--border-subtle)',
                background: selected ? 'var(--brand-soft)' : 'var(--surface-2)',
              }}
            >
              <span
                aria-hidden="true"
                className="size-8 shrink-0 rounded-md"
                style={{ background: preset.swatch }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span style={{ ...TYPE.sectionHeader, color: 'var(--text-primary)' }}>
                  {preset.productName}
                </span>
                <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                  {preset.tagline}
                </span>
              </span>
              {selected ? (
                <Check aria-hidden="true" size={18} style={{ color: 'var(--brand)' }} />
              ) : null}
              {pending === preset.id ? (
                <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>…</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Product name (optional)
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={nameDraft}
            maxLength={40}
            placeholder={productName}
            onChange={(e) => setNameDraft(e.target.value)}
            className="min-w-0 flex-1 rounded-md border px-3 py-2"
            style={{
              ...TYPE.body,
              borderColor: 'var(--border-subtle)',
              background: 'var(--surface-2)',
              color: 'var(--text-primary)',
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => void apply({ productName: nameDraft }, 'name')}
          >
            {pending === 'name' ? 'Saving…' : 'Apply'}
          </Button>
        </div>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Leave it empty to use the selected identity’s own name.
        </span>
      </label>

      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--crit)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
