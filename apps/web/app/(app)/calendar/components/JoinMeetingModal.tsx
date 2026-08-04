'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Video } from 'lucide-react';
import type { Client } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

import { orgTypeLabel } from '../lib/calendar-meeting';
import type { JoinMeetingResponse, JoinOrgOption } from '../types';

/**
 * Client-side mirror of the route's URL guard: parseable, http(s), dotted host.
 * Only gates the button for fast feedback — the route re-validates authoritatively.
 */
function isPlausibleJoinUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/**
 * On-demand meeting join (P4.2). Paste a meeting link + optional title + optional
 * org, confirm ("Gracie will join and record this meeting"), then dispatch a
 * Recall bot immediately via `POST /api/calendar/join`. Shown only when the Admin
 * master switch is on. The Assistant stays read-only — this lives on Calendar.
 */
export function JoinMeetingModal({
  onClose,
  onJoined,
}: {
  readonly onClose: () => void;
  readonly onJoined: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState(''); // '' = Unassigned (external)
  const [orgs, setOrgs] = useState<readonly JoinOrgOption[] | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<JoinMeetingResponse['meeting'] | null>(null);

  // Org picker options: the GA internal workspace + every non-internal party.
  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<{ clients: readonly Client[] }>('/api/clients?type=all'),
      apiClient.get<{ clients: readonly Client[] }>('/api/clients?type=internal'),
    ])
      .then(([all, internal]) => {
        if (!active) return;
        const options: JoinOrgOption[] = [
          ...internal.clients.map((c) => ({ id: c.id, label: 'Internal (GA)' })),
          ...all.clients.map((c) => ({
            id: c.id,
            label: c.type !== 'client' ? `${c.name} (${orgTypeLabel(c.type)})` : c.name,
          })),
        ];
        setOrgs(options);
      })
      .catch((e: unknown) => {
        if (active) setOrgError(e instanceof Error ? e.message : 'Failed to load orgs');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const urlValid = isPlausibleJoinUrl(url);
  const locked = confirming || submitting;

  const submit = useCallback((): void => {
    setSubmitting(true);
    setError(null);
    apiClient
      .post<JoinMeetingResponse>('/api/calendar/join', {
        url: url.trim(),
        title: title.trim() !== '' ? title.trim() : undefined,
        clientId: clientId !== '' ? clientId : undefined,
      })
      .then((d) => setJoined(d.meeting))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to join meeting');
        setConfirming(false); // let the user fix input and retry
      })
      .finally(() => setSubmitting(false));
  }, [url, title, clientId]);

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  const footer =
    joined !== null ? (
      <Button variant="primary" onClick={onJoined}>
        Done
      </Button>
    ) : confirming ? (
      <>
        <Button
          variant="secondary"
          onClick={(): void => setConfirming(false)}
          disabled={submitting}
        >
          Back
        </Button>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? 'Sending Gracie…' : 'Join & record now'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={(): void => setConfirming(true)} disabled={!urlValid}>
          Continue
        </Button>
      </>
    );

  return (
    <Modal isOpen onClose={onClose} title="Join a meeting" footer={footer}>
      {joined !== null ? (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CheckCircle2
            size={40}
            aria-hidden="true"
            style={{ color: 'var(--color-emerald-500)' }}
          />
          <div className="flex flex-col gap-1">
            <span style={TYPE.bodyStrong}>Gracie is joining “{joined.title}”.</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              A notetaker bot has been dispatched. The meeting appears on today’s calendar now, and
              its notes, docs, and tasks generate automatically once it ends.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Meeting link</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://…"
              className={inputClass}
              style={inputStyle}
              value={url}
              disabled={locked}
              onChange={(e): void => setUrl(e.target.value)}
              aria-label="Meeting link"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Title (optional)</span>
            <input
              type="text"
              placeholder="Ad-hoc meeting"
              className={inputClass}
              style={inputStyle}
              value={title}
              disabled={locked}
              onChange={(e): void => setTitle(e.target.value)}
              aria-label="Meeting title"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Client (optional)</span>
            <select
              className={inputClass}
              style={inputStyle}
              value={clientId}
              disabled={locked || orgs === null}
              onChange={(e): void => setClientId(e.target.value)}
              aria-label="Client"
            >
              <option value="">Unassigned (external)</option>
              {(orgs ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {orgError !== null ? (
              <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                Couldn’t load orgs — you can still join as unassigned.
              </span>
            ) : null}
          </label>

          {confirming ? (
            <div
              className="flex items-start gap-2 rounded-lg border p-3"
              style={{
                borderColor: 'var(--border-subtle)',
                backgroundColor: 'var(--surface-muted, #f8fafc)',
              }}
              role="status"
            >
              <Video
                size={16}
                aria-hidden="true"
                style={{ color: 'var(--color-blue-600)', marginTop: 2 }}
              />
              <span style={{ ...TYPE.secondary, color: 'var(--text-primary)' }}>
                Gracie will join and record this meeting. A real notetaker bot joins immediately and
                is visible to attendees.
              </span>
            </div>
          ) : null}

          {error !== null ? (
            <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
              {error}
            </span>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
