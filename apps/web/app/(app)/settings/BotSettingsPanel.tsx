'use client';

/**
 * Meeting Bot settings (Settings → Meeting Bot). Admin-only. Controls how Gracie's
 * Recall bot appears/behaves in a call: display name, a static image tile
 * (Recall `automatic_video_output`), and auto-leave timeouts. DB-backed via
 * `/api/settings/bot`, so edits apply to the next dispatch with no redeploy.
 *
 * Observe-only is a guarantee, not a toggle: Gracie never chats, speaks, or reacts
 * in a meeting (we never call any Recall output/chat endpoint) — shown here as a
 * locked assurance so no one can accidentally make her engage attendees.
 */
import { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface AutoLeave {
  readonly everyoneLeftSec: number | null;
  readonly waitingRoomSec: number | null;
  readonly noRecordingSec: number | null;
  readonly nooneJoinedSec: number | null;
}
interface BotConfigView {
  readonly name: string;
  readonly avatarEnabled: boolean;
  readonly autoLeave: AutoLeave;
  readonly hasAvatar: boolean;
  readonly avatarDataUrl: string | null;
}
interface BotConfigResponse {
  readonly config: BotConfigView;
}

type AutoLeaveField = keyof AutoLeave;

/** Auto-leave inputs, in seconds, with Recall's own default shown as the hint. */
const AUTO_LEAVE_FIELDS: ReadonlyArray<{
  readonly key: AutoLeaveField;
  readonly label: string;
  readonly recallDefault: number;
}> = [
  { key: 'everyoneLeftSec', label: 'Leave after everyone else leaves', recallDefault: 2 },
  { key: 'waitingRoomSec', label: 'Give up in the waiting room after', recallDefault: 1200 },
  { key: 'noRecordingSec', label: 'Leave if it never starts recording after', recallDefault: 3600 },
  { key: 'nooneJoinedSec', label: 'Leave if no one ever joins after', recallDefault: 1200 },
];

const MAX_AVATAR_BYTES = 1_300_000;
const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

export function BotSettingsPanel(): React.JSX.Element {
  const [config, setConfig] = useState<BotConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editable state.
  const [name, setName] = useState('');
  const [avatarEnabled, setAvatarEnabled] = useState(false);
  const [autoLeaveStr, setAutoLeaveStr] = useState<Record<AutoLeaveField, string>>({
    everyoneLeftSec: '',
    waitingRoomSec: '',
    noRecordingSec: '',
    nooneJoinedSec: '',
  });
  // Pending avatar edit: a newly-selected data URL, or a flag to remove the current one.
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const hydrate = useCallback((c: BotConfigView): void => {
    setConfig(c);
    setName(c.name);
    setAvatarEnabled(c.avatarEnabled);
    setAutoLeaveStr({
      everyoneLeftSec: c.autoLeave.everyoneLeftSec?.toString() ?? '',
      waitingRoomSec: c.autoLeave.waitingRoomSec?.toString() ?? '',
      noRecordingSec: c.autoLeave.noRecordingSec?.toString() ?? '',
      nooneJoinedSec: c.autoLeave.nooneJoinedSec?.toString() ?? '',
    });
    setPendingDataUrl(null);
    setRemoveAvatar(false);
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .get<BotConfigResponse>('/api/settings/bot')
      .then((d) => {
        if (active) hydrate(d.config);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load bot settings');
      });
    return (): void => {
      active = false;
    };
  }, [hydrate]);

  const onPickFile = useCallback((file: File | undefined): void => {
    setMessage(null);
    if (file === undefined) return;
    if (!/jpe?g$/i.test(file.type)) {
      setMessage({ text: 'Please choose a JPEG image.', ok: false });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setMessage({ text: 'Image must be 1.3 MB or smaller.', ok: false });
      return;
    }
    const reader = new FileReader();
    reader.onload = (): void => {
      setPendingDataUrl(String(reader.result));
      setRemoveAvatar(false);
      setAvatarEnabled(true); // uploading a new image implies you want it shown
    };
    reader.onerror = (): void => setMessage({ text: 'Could not read that file.', ok: false });
    reader.readAsDataURL(file);
  }, []);

  const previewUrl = pendingDataUrl ?? (removeAvatar ? null : (config?.avatarDataUrl ?? null));

  const parseSeconds = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };

  const save = useCallback((): void => {
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      name,
      avatarEnabled,
      autoLeave: {
        everyoneLeftSec: parseSeconds(autoLeaveStr.everyoneLeftSec),
        waitingRoomSec: parseSeconds(autoLeaveStr.waitingRoomSec),
        noRecordingSec: parseSeconds(autoLeaveStr.noRecordingSec),
        nooneJoinedSec: parseSeconds(autoLeaveStr.nooneJoinedSec),
      },
    };
    if (pendingDataUrl !== null) {
      body.avatar = { jpegB64: pendingDataUrl.slice(pendingDataUrl.indexOf(',') + 1) };
    } else if (removeAvatar) {
      body.avatar = null;
    }

    apiClient
      .patch<BotConfigResponse>('/api/settings/bot', body)
      .then((d) => {
        hydrate(d.config);
        setMessage({ text: 'Saved.', ok: true });
      })
      .catch((e: unknown) => setMessage({ text: e instanceof Error ? e.message : 'Save failed.', ok: false }))
      .finally(() => setSaving(false));
  }, [name, avatarEnabled, autoLeaveStr, pendingDataUrl, removeAvatar, hydrate]);

  if (loadError !== null) return <ErrorState title="Couldn’t load bot settings" description={loadError} />;
  if (config === null) return <LoadingState label="Loading bot settings…" />;

  return (
    <div className="flex flex-col gap-6">
      {/* Name */}
      <label className="flex max-w-md flex-col gap-1">
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Display name (shown to attendees)</span>
        <input
          type="text"
          className={inputClass}
          style={inputStyle}
          value={name}
          maxLength={100}
          disabled={saving}
          onChange={(e): void => setName(e.target.value)}
          aria-label="Bot display name"
        />
      </label>

      {/* Avatar */}
      <div className="flex flex-col gap-2">
        <ToggleSwitch
          checked={avatarEnabled}
          onChange={setAvatarEnabled}
          disabled={saving}
          label="Show an image tile in the meeting"
          ariaLabel="Show bot avatar tile"
        />
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          Gracie appears as a video tile showing this image (like tl;dv). JPEG, 16:9, ~1280×720, ≤1.3 MB.
        </span>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center overflow-hidden rounded-lg border"
            style={{ width: 160, height: 90, borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}
          >
            {previewUrl !== null ? (
              <img src={previewUrl} alt="Bot avatar preview" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>No image</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label>
              <input
                type="file"
                accept="image/jpeg"
                disabled={saving}
                className="hidden"
                onChange={(e): void => onPickFile(e.target.files?.[0])}
              />
              <span
                className="inline-flex cursor-pointer items-center rounded-lg border px-3 py-1.5"
                style={{ borderColor: 'var(--border-subtle)', ...TYPE.bodyStrong }}
              >
                Choose image…
              </span>
            </label>
            {previewUrl !== null ? (
              <button
                type="button"
                disabled={saving}
                onClick={(): void => {
                  setPendingDataUrl(null);
                  setRemoveAvatar(true);
                }}
                style={{ ...TYPE.label, color: 'var(--color-red-600)', cursor: 'pointer', textAlign: 'left' }}
              >
                Remove image
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Auto-leave */}
      <fieldset className="flex flex-col gap-2">
        <legend style={TYPE.bodyStrong}>Auto-leave</legend>
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          When Gracie should give up and leave, in seconds. Leave blank to use Recall’s default (shown in
          each box). Prevents a bot lingering in an empty call.
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          {AUTO_LEAVE_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{f.label}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={inputClass}
                style={inputStyle}
                placeholder={`Default: ${f.recallDefault}s`}
                value={autoLeaveStr[f.key]}
                disabled={saving}
                onChange={(e): void =>
                  setAutoLeaveStr((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                aria-label={f.label}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {/* Observe-only assurance (locked) */}
      <div
        className="flex items-start gap-2 rounded-lg border p-3"
        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--color-slate-100)' }}
      >
        <Lock size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
        <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
          <strong>Observe-only.</strong> Gracie never chats, speaks, or reacts in a meeting — she only
          records for notes. This can’t be turned on, so she can never disrupt or engage your customers.
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {message !== null ? (
          <span
            role={message.ok ? undefined : 'alert'}
            style={{ ...TYPE.secondary, color: message.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
