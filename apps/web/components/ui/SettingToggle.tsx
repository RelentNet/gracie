'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

/**
 * A self-contained boolean setting: loads its current value from `getUrl` on
 * mount, renders a checkbox + label + description, and optimistically PATCHes
 * `patchUrl` with `{ enabled }` on toggle (reverting on failure). `responseKey`
 * is the boolean field to read back from both the GET and PATCH responses.
 *
 * Collapses the copy-pasted toggle skeleton shared by the calendar auto-join
 * preference and the admin bot-dispatch / on-demand-join master switches.
 */
export function SettingToggle({
  getUrl,
  patchUrl,
  responseKey,
  defaultValue,
  label,
  description,
}: {
  readonly getUrl: string;
  readonly patchUrl: string;
  readonly responseKey: string;
  /** Value shown until loaded and the fallback if the load/save fails. */
  readonly defaultValue: boolean;
  readonly label: string;
  readonly description: string;
}): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<Record<string, unknown>>(getUrl)
      .then((data) => {
        if (active) setEnabled(Boolean(data[responseKey]));
      })
      .catch(() => {
        if (active) setEnabled(defaultValue);
      });
    return (): void => {
      active = false;
    };
  }, [getUrl, responseKey, defaultValue]);

  const onToggle = useCallback(
    (next: boolean): void => {
      const previous = enabled;
      setEnabled(next); // optimistic
      setSaving(true);
      setNote(null);
      apiClient
        .patch<Record<string, unknown>>(patchUrl, { enabled: next })
        .then((data) => setEnabled(Boolean(data[responseKey])))
        .catch((e: unknown) => {
          setEnabled(previous);
          setNote(e instanceof Error ? e.message : 'Could not save setting');
        })
        .finally(() => setSaving(false));
    },
    [enabled, patchUrl, responseKey],
  );

  return (
    <div
      className="flex flex-col gap-1 border-t pt-3"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? defaultValue}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>{label}</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{description}</span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
