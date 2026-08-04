'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AlertTriangle, Building2, Link2, Lock, Video, X } from 'lucide-react';
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
  onChanged,
}: {
  readonly dayKey: string;
  readonly meetings: readonly CalendarMeeting[];
  readonly loading: boolean;
  readonly editable: boolean;
  readonly onChanged: () => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader title={localDayLabel(dayKey)} description={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`} />
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
              <MeetingCard meeting={m} editable={editable} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
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
      style={{ backgroundColor: bg, color: fg, fontSize: '0.6875rem', fontWeight: 600, padding: '0.0625rem 0.375rem' }}
    >
      <Link href={`/clients/${org.id}`} className="inline-flex items-center gap-1" style={{ color: fg }}>
        {isInternal ? <Lock size={11} aria-hidden="true" /> : <Building2 size={11} aria-hidden="true" />}
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
function ExternalAttendeesList({ people }: { readonly people: readonly ExternalAttendee[] }): React.JSX.Element {
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

/** One meeting in the day-detail: status, org chips, external people, org actions. */
function MeetingCard({
  meeting,
  editable,
  onChanged,
}: {
  readonly meeting: CalendarMeeting;
  readonly editable: boolean;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const m = meeting;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState<{ domain: string; type: ClientType } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const attention = meetingNeedsAttention(m);

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
          <Link href={`/meetings/${m.id}`} className="w-fit hover:underline" style={TYPE.bodyStrong}>
            {m.title ?? 'Untitled meeting'}
          </Link>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{localTime(m.dateTime)}</span>
        </div>
        <StatusBadge status={toBadgeStatus(m.pipelineStatus)} size="sm" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {m.isInternal ? (
          <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)" icon={<Lock size={11} aria-hidden="true" />}>
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
          <Badge bg="var(--color-amber-100)" fg="var(--color-amber-600)" icon={<AlertTriangle size={11} aria-hidden="true" />}>
            No client
          </Badge>
        ) : null}
        {m.isBotDispatched ? (
          <span className="inline-flex items-center gap-1" style={{ ...TYPE.label, color: 'var(--color-emerald-600)' }}>
            <Video size={13} aria-hidden="true" /> Bot dispatched
          </span>
        ) : null}
      </div>

      {m.attendees.length > 0 ? <PeopleRow people={m.attendees} /> : null}

      {m.externalAttendees.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>External attendees</span>
          <ExternalAttendeesList people={m.externalAttendees} />
        </div>
      ) : null}

      {editable && (m.unknownOrgDomains.length > 0 || m.orgs.length === 0) && !m.isInternal ? (
        <div
          className="flex flex-col gap-2 rounded-lg border p-2"
          style={{ borderColor: 'var(--color-amber-200, var(--border-subtle))' }}
        >
          {m.unknownOrgDomains.map((domain) => (
            <div key={domain} className="flex flex-wrap items-center gap-2">
              <span className="font-data" style={{ ...TYPE.label, color: 'var(--text-primary)' }}>
                {domain}
              </span>
              <Button size="sm" variant="secondary" onClick={(): void => setCreate({ domain, type: 'client' })}>
                Create client
              </Button>
              <Button size="sm" variant="secondary" onClick={(): void => setCreate({ domain, type: 'lead' })}>
                Create lead
              </Button>
            </div>
          ))}
          <button
            type="button"
            onClick={(): void => setLinkOpen(true)}
            className="inline-flex w-fit items-center gap-1"
            style={{ ...TYPE.label, color: 'var(--color-blue-600)', cursor: 'pointer' }}
          >
            <Link2 size={13} aria-hidden="true" /> Link an existing org
          </button>
        </div>
      ) : null}

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
        <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>+{people.length - shown.length}</span>
      ) : null}
    </span>
  );
}
