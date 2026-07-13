'use client';

/**
 * Company settings (Settings → Company, P9). Admin-only. Edits the firm description
 * (used by the Assistant + generation prompts) and the internal email domains (which
 * classify a meeting as internal and are excluded from client-domain matching).
 *
 * The internal-domain floor (e.g. graceandassociates.com) is shown locked and can't
 * be removed — the server rejects removing it too, so the internal decision can never
 * silently open up.
 */
import { useCallback, useEffect, useState } from 'react';
import { Lock, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface CompanySettings {
  readonly companyDescription: string;
  readonly internalDomains: readonly string[];
  readonly floorDomains: readonly string[];
}
interface SettingsResponse {
  readonly settings: CompanySettings;
}

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

export function CompanySettingsPanel(): React.JSX.Element {
  const [floorDomains, setFloorDomains] = useState<readonly string[]>([]);
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const hydrate = useCallback((s: CompanySettings): void => {
    setFloorDomains(s.floorDomains);
    setDescription(s.companyDescription);
    setDomains([...s.internalDomains]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .get<SettingsResponse>('/api/settings/company')
      .then((d) => {
        if (active) hydrate(d.settings);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load company settings');
      });
    return (): void => {
      active = false;
    };
  }, [hydrate]);

  const isFloor = (d: string): boolean => floorDomains.includes(d);

  const addDomain = useCallback((): void => {
    const d = domainInput.trim().toLowerCase();
    setNote(null);
    if (d === '') return;
    if (d.includes('@') || !d.includes('.') || /\s/.test(d)) {
      setNote({ text: `“${domainInput.trim()}” doesn’t look like a domain (e.g. acme.com).`, ok: false });
      return;
    }
    setDomains((prev) => (prev.includes(d) ? prev : [...prev, d].sort()));
    setDomainInput('');
  }, [domainInput]);

  const removeDomain = (d: string): void => {
    if (isFloor(d)) return; // floor domains can't be removed
    setDomains((prev) => prev.filter((x) => x !== d));
    setNote(null);
  };

  const save = useCallback((): void => {
    setSaving(true);
    setNote(null);
    apiClient
      .patch<SettingsResponse>('/api/settings/company', {
        companyDescription: description,
        internalDomains: domains,
      })
      .then((d) => {
        hydrate(d.settings);
        setNote({ text: 'Saved.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Save failed.', ok: false }))
      .finally(() => setSaving(false));
  }, [description, domains, hydrate]);

  if (loadError !== null) return <ErrorState title="Couldn’t load company settings" description={loadError} />;
  if (!loaded) return <LoadingState label="Loading company settings…" />;

  return (
    <div className="flex flex-col gap-6">
      {/* Company description */}
      <label className="flex flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Company description</span>
        <textarea
          className={inputClass}
          style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
          value={description}
          maxLength={5000}
          disabled={saving}
          onChange={(e): void => setDescription(e.target.value)}
          aria-label="Company description"
        />
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Used by the Assistant and Gracie’s note generation to describe who Grace &amp; Associates is.
        </span>
      </label>

      {/* Internal email domains */}
      <fieldset className="flex flex-col gap-2">
        <legend style={TYPE.bodyStrong}>Internal email domains</legend>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Your own email domains. Attendees on these count as internal, and these are never treated as a
          client’s domain. The floor domain is locked and can’t be removed.
        </span>
        <div className="flex flex-wrap gap-2">
          {domains.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)', ...TYPE.label }}
            >
              <span className="font-data">{d}</span>
              {isFloor(d) ? (
                <Lock size={12} aria-label="Required — can’t be removed" style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <button
                  type="button"
                  onClick={(): void => removeDomain(d)}
                  disabled={saving}
                  aria-label={`Remove ${d}`}
                  style={{ cursor: saving ? 'default' : 'pointer', color: 'var(--text-secondary)', display: 'inline-flex' }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className={`${inputClass} max-w-xs`}
            style={inputStyle}
            placeholder="add a domain, e.g. acme.com"
            value={domainInput}
            disabled={saving}
            onChange={(e): void => setDomainInput(e.target.value)}
            onKeyDown={(e): void => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
              }
            }}
            aria-label="Add an internal domain"
          />
          <Button variant="secondary" onClick={addDomain} disabled={saving || domainInput.trim() === ''}>
            Add
          </Button>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
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
