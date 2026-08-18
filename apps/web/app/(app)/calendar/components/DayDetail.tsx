'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AlertTriangle, Building2, Link2, Lock, Video, VideoOff, X } from 'lucide-react';
import type {
  CalendarMeeting,
  CalendarPerson,
  ClientType,
  ExternalAttendee,
  MeetingOrg,
} from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ClientAvatar } from '@/components/ClientAvatar';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, LoadingState } from '@/components/ui/StateViews';

import { localDayLabel, localTime } from '../lib/calendar-dates';
import { meetingNeedsAttention, orgTypeLabel, toBadgeStatus } from '../lib/calendar-meeting';
import { CreateOrgModal } from './CreateOrgModal';
import { LinkExistingModal } from './LinkExistingModal';

export function DayDetail({
  dayKey,
  meetings,
  loading,
  editable,
  canRedispatch,
  canConfigureBot,
  onChanged,
}: {
  readonly dayKey: string;
  readonly meetings: readonly CalendarMeeting[];
  readonly loading: boolean;
  readonly editable: boolean;
  /** Show the manual "Send Gracie" re-dispatch action (admin + on-demand-join on). */
  readonly canRedispatch: boolean;
  /** Show the per-meeting "Don't record" ignore-list toggle (admin / calendar.configure). */
  readonly canConfigureBot: boolean;
  readonly onChanged: () => void;
}): React.JSX.Element {
  return (
    <Card className="flex min-h-0 flex-1 flex-col p-6">
      <CardHeader
        title={localDayLabel(dayKey)}
        description={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`}
      />
      {/* Scrolls within the card so the agenda equalizes with the calendar's
          height and shows ~3 meetings at a time on desktop; flows fully on mobile
          where the wrapping column is unbounded. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <LoadingState label="Loading meetings…" />
        ) : meetings.length === 0 ? (
          <EmptyState title="No meetings" description="Nothing scheduled for this day." />
        ) : (
          <ul className="flex flex-col gap-4">
            {meetings.map((m) => (
              <li
                key={m.id}
                className="border-t pt-4 first:border-t-0 first:pt-0"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <MeetingCard
                  meeting={m}
                  editable={editable}
                  canRedispatch={canRedispatch}
                  canConfigureBot={canConfigureBot}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** One org chip (linked client/lead/prospect/internal) with an optional remove. */
function OrgChip({
  org,
  onRemove,
  removing,
}: {
  readonly org: MeetingOrg;
  readonly onRemove?: () => void;
  readonly removing: boolean;
}): React.JSX.Element {
  const isInternal = org.type === 'internal';
  const bg = isInternal ? 'var(--color-slate-100)' : 'var(--color-blue-100)';
  const fg = isInternal ? 'var(--color-slate-600)' : 'var(--color-blue-700)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md"
      style={{
        backgroundColor: bg,
        color: fg,
        fontSize: '0.6875rem',
        fontWeight: 600,
        padding: '0.0625rem 0.375rem',
      }}
    >
      <Link
        href={`/clients/${org.id}`}
        className="inline-flex items-center gap-1"
        style={{ color: fg }}
      >
        {isInternal ? (
          <Lock size={11} aria-hidden="true" />
        ) : (
          <Building2 size={11} aria-hidden="true" />
        )}
        {org.name}
      </Link>
      {!isInternal && org.type !== 'client' ? (
        <span style={{ opacity: 0.7 }}>· {orgTypeLabel(org.type)}</span>
      ) : null}
      {onRemove !== undefined && !isInternal ? (
        <button
          type="button"
          aria-label={`Unlink ${org.name}`}
          onClick={onRemove}
          disabled={removing}
          style={{ color: fg, cursor: removing ? 'wait' : 'pointer', lineHeight: 0 }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/** The external (non-GA) attendees on a meeting, name + email. */
function ExternalAttendeesList({
  people,
}: {
  readonly people: readonly ExternalAttendee[];
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      {people.map((p) => (
        <li key={p.email} style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-primary)' }}>{p.name ?? p.email}</span>
          {p.name !== null ? <span> · {p.email}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Manual "Send Gracie" — re-dispatch a fresh Recall bot to THIS meeting's stored
 * join link on demand (e.g. the auto bot timed out on a late-starting meeting).
 * Confirms, POSTs to the redispatch route, and shows a sending→Sent state.
 * Disabled (with a tooltip) when the meeting has no join link.
 */
function RedispatchButton({ meeting }: { readonly meeting: CalendarMeeting }): React.JSX.Element {
  const hasLink = meeting.videoLink !== null && meeting.videoLink !== '';
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((): void => {
    if (!window.confirm('Send Gracie to this meeting now?')) return;
    setState('sending');
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meeting.id}/redispatch`)
      .then(() => setState('sent'))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to send Gracie');
        setState('idle');
      });
  }, [meeting.id]);

  return (
    <div className="flex flex-col gap-1">
      {/* Wrap in a title span so the tooltip shows even when the button is disabled. */}
      <span title={hasLink ? 'Send a fresh notetaker bot to this meeting now' : 'No join link on this meeting'}>
        <Button
          size="sm"
          variant="secondary"
          disabled={!hasLink || state !== 'idle'}
          icon={<Video size={13} aria-hidden="true" />}
          onClick={send}
        >
          {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : 'Send Gracie'}
        </Button>
      </span>
      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "Don't record" toggle — put this meeting's recurring series (or one-off join link)
 * on the meeting-bot ignore list so Gracie stops auto-joining it (the ghost-meeting
 * guard for stale/duplicate calendar entries). Fully reversible: turning it back on
 * restores dispatch. Enabling asks for confirmation since it affects the whole series.
 */
function IgnoreRecordingControl({
  meeting,
  onChanged,
}: {
  readonly meeting: CalendarMeeting;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const ignored = meeting.recordingIgnored;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((): void => {
    const enabling = !ignored;
    if (
      enabling &&
      !window.confirm(
        "Stop Gracie recording this meeting and its whole series? You can turn recording back on here anytime.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meeting.id}/ignore`, { ignore: enabling })
      .then(() => onChanged())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to update recording setting'))
      .finally(() => setBusy(false));
  }, [ignored, meeting.id, onChanged]);

  if (ignored) {
    return (
      <div className="flex flex-col gap-1">
        <span
          className="inline-flex items-center gap-1"
          style={{ ...TYPE.label, color: 'var(--text-secondary)' }}
        >
          <VideoOff size={13} aria-hidden="true" /> Gracie won&apos;t record this
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="inline-flex w-fit items-center gap-1"
          style={{ ...TYPE.label, color: 'var(--color-blue-600)', cursor: busy ? 'wait' : 'pointer' }}
        >
          <Video size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Turn recording on'}
        </button>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span title="Stop Gracie auto-joining this meeting and its series">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          icon={<VideoOff size={13} aria-hidden="true" />}
          onClick={toggle}
        >
          {busy ? 'Saving…' : "Don't record"}
        </Button>
      </span>
      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** One meeting in the day-detail: status, org chips, external people, org actions. */
function MeetingCard({
  meeting,
  editable,
  canRedispatch,
  canConfigureBot,
  onChanged,
}: {
  readonly meeting: CalendarMeeting;
  readonly editable: boolean;
  readonly canRedispatch: boolean;
  readonly canConfigureBot: boolean;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const m = meeting;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState<{ domain: string; type: ClientType } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const attention = meetingNeedsAttention(m);
  // Best domain to bind a brand-new client to when none is flagged as unknown.
  // A non-internal meeting always has ≥1 external attendee, so this is defined
  // whenever the assignment block shows — the "Create a new client" action is
  // therefore always available, never only when there's an unrecognized domain.
  const createDomain = m.unknownOrgDomains[0] ?? m.externalAttendees[0]?.domain ?? null;

  const unlink = useCallback(
    (clientId: string): void => {
      setBusy(`unlink:${clientId}`);
      setError(null);
      apiClient
        .post(`/api/calendar/meetings/${m.id}/orgs`, { clientId, action: 'unlink' })
        .then(() => onChanged())
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to unlink org'))
        .finally(() => setBusy(null));
    },
    [m.id, onChanged],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/meetings/${m.id}`}
            className="w-fit hover:underline"
            style={TYPE.bodyStrong}
          >
            {m.title ?? 'Untitled meeting'}
          </Link>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {localTime(m.dateTime)}
          </span>
        </div>
        <StatusBadge status={toBadgeStatus(m.pipelineStatus)} size="sm" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {m.isInternal ? (
          <Badge
            bg="var(--color-slate-100)"
            fg="var(--color-slate-600)"
            icon={<Lock size={11} aria-hidden="true" />}
          >
            Internal
          </Badge>
        ) : null}
        {m.orgs
          .filter((o) => !(m.isInternal && o.type === 'internal'))
          .map((o) => (
            <OrgChip
              key={o.id}
              org={o}
              removing={busy === `unlink:${o.id}`}
              onRemove={editable ? (): void => unlink(o.id) : undefined}
            />
          ))}
        {attention ? (
          <Badge
            bg="var(--color-amber-100)"
            fg="var(--color-amber-600)"
            icon={<AlertTriangle size={11} aria-hidden="true" />}
          >
            No client
          </Badge>
        ) : null}
        {m.isBotDispatched ? (
          <span
            className="inline-flex items-center gap-1"
            style={{ ...TYPE.label, color: 'var(--color-emerald-600)' }}
          >
            <Video size={13} aria-hidden="true" /> Bot dispatched
          </span>
        ) : null}
      </div>

      {m.attendees.length > 0 ? <PeopleRow people={m.attendees} /> : null}

      {/* External attendees — long lists live behind a collapsed dropdown. The
          "create client / prospect / lead / partner" + link actions live INSIDE
          it (kept for prospecting); the visible "No client" badge above still
          flags meetings that need assignment even while this is collapsed. */}
      {m.externalAttendees.length > 0 ? (
        <details>
          <summary style={{ ...TYPE.label, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            External attendees ({m.externalAttendees.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <ExternalAttendeesList people={m.externalAttendees} />

            {editable && (m.unknownOrgDomains.length > 0 || m.orgs.length === 0) && !m.isInternal ? (
              <div
                className="flex flex-col gap-2 rounded-lg border p-2"
                style={{ borderColor: 'var(--color-amber-200, var(--border-subtle))' }}
              >
                {m.unknownOrgDomains.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                      Unrecognized {m.unknownOrgDomains.length === 1 ? 'domain' : 'domains'}
                    </span>
                    {m.unknownOrgDomains.map((domain) => (
                      <div key={domain} className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-data"
                          style={{ ...TYPE.label, color: 'var(--text-primary)' }}
                        >
                          {domain}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(): void => setCreate({ domain, type: 'client' })}
                        >
                          Create new client
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Always offer BOTH create + link. When a domain is already flagged
                    above, its per-domain button is the create path, so the generic
                    "Create a new client" only shows when nothing was flagged. */}
                <div className="flex flex-wrap items-center gap-3">
                  {m.unknownOrgDomains.length === 0 && createDomain !== null ? (
                    <button
                      type="button"
                      onClick={(): void => setCreate({ domain: createDomain, type: 'client' })}
                      className="inline-flex w-fit items-center gap-1"
                      style={{ ...TYPE.label, color: 'var(--color-blue-600)', cursor: 'pointer' }}
                    >
                      <Building2 size={13} aria-hidden="true" /> Create a new client
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={(): void => setLinkOpen(true)}
                    className="inline-flex w-fit items-center gap-1"
                    style={{ ...TYPE.label, color: 'var(--color-blue-600)', cursor: 'pointer' }}
                  >
                    <Link2 size={13} aria-hidden="true" /> Link an existing org
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {m.videoLink !== null ? (
          <a
            href={m.videoLink}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex w-fit items-center gap-1"
            style={{ ...TYPE.label, color: 'var(--color-blue-600)' }}
          >
            <Video size={13} aria-hidden="true" /> Join link
          </a>
        ) : null}
        {canRedispatch ? <RedispatchButton meeting={m} /> : null}
        {canConfigureBot ? <IgnoreRecordingControl meeting={m} onChanged={onChanged} /> : null}
      </div>

      {error !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {error}
        </span>
      ) : null}

      {create !== null ? (
        <CreateOrgModal
          meetingId={m.id}
          domain={create.domain}
          defaultType={create.type}
          suggested={m.externalAttendees.find((a) => a.domain === create.domain) ?? null}
          onClose={(): void => setCreate(null)}
          onCreated={(): void => {
            setCreate(null);
            onChanged();
          }}
        />
      ) : null}

      {linkOpen ? (
        <LinkExistingModal
          meetingId={m.id}
          linkedIds={m.orgs.map((o) => o.id)}
          unknownDomains={m.unknownOrgDomains}
          onClose={(): void => setLinkOpen(false)}
          onLinked={(): void => {
            setLinkOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function PeopleRow({ people }: { readonly people: readonly CalendarPerson[] }): React.JSX.Element {
  const shown = people.slice(0, 5);
  return (
    <span className="flex items-center gap-1">
      {shown.map((p) => (
        <span key={p.id} title={p.name}>
          <ClientAvatar initials={p.initials} size="sm" />
        </span>
      ))}
      {people.length > shown.length ? (
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
          +{people.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}
