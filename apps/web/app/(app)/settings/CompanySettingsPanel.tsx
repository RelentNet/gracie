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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';

/** Client-side courtesy cap; the server enforces the real 1 MB limit. */
const MAX_LOGO_BYTES = 1024 * 1024;
const ACCEPTED_LOGO = 'image/png,image/jpeg,image/svg+xml';

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

/**
 * One brand-logo upload + preview control, for a single theme variant. Rendered
 * twice by the panel below — the main (light) logo and the optional dark-theme
 * variant — so the upload/remove/preview logic lives in one place. Admin-only
 * (the API enforces it); the nav re-hydrates via `router.refresh()` on change.
 */
function LogoField({
  variant,
  label,
  help,
  initialKey,
  emptyPreview,
}: {
  readonly variant: 'light' | 'dark';
  readonly label: string;
  readonly help: string;
  readonly initialKey: string | null;
  /** Shown on the preview swatch when this variant is unset. */
  readonly emptyPreview: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  // Local mirror for instant preview; the nav re-hydrates from the server on refresh.
  const [logoKey, setLogoKey] = useState<string | null>(initialKey);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    (file: File): void => {
      setNote(null);
      if (file.size > MAX_LOGO_BYTES) {
        setNote({ text: 'Logo must be 1 MB or smaller.', ok: false });
        return;
      }
      setBusy(true);
      const body = new FormData();
      body.set('file', file);
      body.set('variant', variant);
      fetch('/api/brand/logo', { method: 'POST', body })
        .then(async (res) => {
          const payload = (await res.json().catch(() => null)) as
            | { brandLogoKey?: string | null; error?: { message?: string } }
            | null;
          if (!res.ok) throw new Error(payload?.error?.message ?? `Upload failed: ${res.status}`);
          setLogoKey(payload?.brandLogoKey ?? null);
          setNote({ text: 'Logo updated.', ok: true });
          router.refresh(); // re-hydrate the nav with the new logo
        })
        .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Upload failed.', ok: false }))
        .finally(() => {
          setBusy(false);
          if (fileInputRef.current !== null) fileInputRef.current.value = '';
        });
    },
    [router, variant],
  );

  const remove = useCallback((): void => {
    setBusy(true);
    setNote(null);
    apiClient
      .del(`/api/brand/logo?variant=${variant}`)
      .then(() => {
        setLogoKey(null);
        setNote({ text: 'Reset to the default.', ok: true });
        router.refresh();
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Remove failed.', ok: false }))
      .finally(() => setBusy(false));
  }, [router, variant]);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend style={TYPE.bodyStrong}>{label}</legend>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{help}</span>
      <div className="flex flex-wrap items-center gap-4">
        {/* Live preview on a dark swatch (both variants preview on dark ground). */}
        <div
          className="flex h-16 min-w-40 items-center justify-center rounded-lg px-4"
          style={{ backgroundColor: 'var(--color-navy-900)' }}
        >
          {logoKey !== null ? (
            // Preview mirrors the nav: <img> only. ?v busts cache on replace.
            <img
              src={`/api/brand/logo?variant=${variant}&v=${encodeURIComponent(logoKey)}`}
              alt={`Current ${label.toLowerCase()}`}
              className="max-w-full object-contain"
              style={{ height: '2rem', width: 'auto' }}
            />
          ) : (
            emptyPreview
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_LOGO}
            disabled={busy}
            aria-label={`Choose a ${label.toLowerCase()} image`}
            onChange={(e): void => {
              const file = e.target.files?.[0];
              if (file !== undefined) upload(file);
            }}
          />
          {logoKey !== null ? (
            <Button variant="secondary" onClick={remove} disabled={busy}>
              Remove / reset to default
            </Button>
          ) : null}
        </div>
      </div>
      {note !== null ? (
        <span
          role={note.ok ? undefined : 'alert'}
          style={{ ...TYPE.secondary, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
        >
          {note.text}
        </span>
      ) : null}
    </fieldset>
  );
}

export function CompanySettingsPanel(): React.JSX.Element {
  const { brandLogoKey, brandLogoDarkKey } = useAuth();
  const router = useRouter();

  const [floorDomains, setFloorDomains] = useState<readonly string[]>([]);
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  // Task-Board visibility — instant-save toggle, independent of the Save button
  // below. Off (default) = admin-only board; on = revealed to every user. A refresh
  // re-hydrates the auth context so the sidebar item appears/disappears immediately.
  const [taskBoardVisible, setTaskBoardVisible] = useState<boolean | null>(null);
  const [tbSaving, setTbSaving] = useState(false);
  const [tbNote, setTbNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ visible: boolean }>('/api/settings/tasks-visibility')
      .then((d) => {
        if (active) setTaskBoardVisible(d.visible);
      })
      .catch(() => {
        if (active) setTaskBoardVisible(false); // default: admin-only
      });
    return (): void => {
      active = false;
    };
  }, []);

  const toggleTaskBoard = useCallback(
    (next: boolean): void => {
      setTaskBoardVisible(next); // optimistic
      setTbSaving(true);
      setTbNote(null);
      apiClient
        .patch<{ visible: boolean }>('/api/settings/tasks-visibility', { visible: next })
        .then((d) => {
          setTaskBoardVisible(d.visible);
          setTbNote({ text: 'Saved.', ok: true });
          router.refresh(); // re-hydrate the nav so the Task Board item updates now
        })
        .catch((e: unknown) => {
          setTaskBoardVisible(!next); // revert on failure
          setTbNote({ text: e instanceof Error ? e.message : 'Save failed.', ok: false });
        })
        .finally(() => setTbSaving(false));
    },
    [router],
  );

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
      {/* Task Board visibility — reveal the admin-only board to everyone when the team
          is ready. Instant-save (separate from the Save button below). */}
      <div className="flex flex-col gap-2 rounded-lg border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={taskBoardVisible ?? false}
            onChange={toggleTaskBoard}
            disabled={taskBoardVisible === null || tbSaving}
            label="Show the Task Board to all users"
            ariaLabel="Show the Task Board to all users"
          />
          {tbNote !== null ? (
            <span
              role={tbNote.ok ? undefined : 'alert'}
              style={{ ...TYPE.secondary, color: tbNote.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
            >
              {tbNote.text}
            </span>
          ) : null}
        </div>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Off = only administrators see the cross-client Task Board. Turn it on when the team is ready and
          every user will see it in the sidebar. Administrators always have access.
        </span>
      </div>

      {/* Branding — the configurable nav logos. Each has its own upload/remove
          controls (multipart), separate from the description/domains Save below.
          The dark variant is optional: if left empty the main logo is used in
          both themes (see LogoField + the Sidebar's theme-conditional render). */}
      <LogoField
        variant="light"
        label="Brand logo"
        help="Shown in the top-left of the navigation. PNG, JPG, or SVG, up to 1 MB. Leave it unset to keep the default “GA App” wordmark."
        initialKey={brandLogoKey}
        emptyPreview={<span style={{ ...TYPE.sectionHeader, color: '#ffffff' }}>GA App</span>}
      />
      <LogoField
        variant="dark"
        label="Dark mode logo (optional)"
        help="Shown on dark backgrounds; if left empty, your main logo is used everywhere."
        initialKey={brandLogoDarkKey}
        emptyPreview={
          <span style={{ ...TYPE.secondary, color: 'rgba(255,255,255,0.7)' }}>Main logo used</span>
        }
      />

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
