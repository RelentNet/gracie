'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Link2,
  Lock,
  RefreshCw,
  Video,
  X,
} from 'lucide-react';
import type {
  AmbiguousMeeting,
  BadgeStatus,
  CalendarConnectionStatus,
  CalendarMeeting,
  CalendarPerson,
  Client,
  ClientCadenceRow,
  ClientType,
  ExternalAttendee,
  MeetingOrg,
  PipelineStatus,
} from '@gracie/shared';
import { deriveOrgNameFromDomain } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatEasternDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { ClientAvatar } from '@/components/ClientAvatar';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

/**
 * Module 7 — Calendar (docs/08 §M7). Real data via `GET /api/calendar*`.
 *
 * Layout: a month grid + day-detail sidebar (left/main), a connection-status
 * panel with the per-user auto-join opt-out (right), an Admin-only ambiguous-
 * meeting assignment list, and a per-client cadence tracker.
 *
 * Meetings, matching, dedup, and bot dispatch are all produced by the P4 worker
 * crons (Microsoft Graph → `meetings`); this page is read-mostly. The only writes
 * are the Admin "assign a client" action and the auto-join toggle.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const ET = 'America/New_York';

/** ET calendar-day key (YYYY-MM-DD) for an ISO instant. */
function easternDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** ET time-of-day (e.g. "2:00 PM") for an ISO instant. */
function easternTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Long ET date label (e.g. "Monday, July 6, 2026") for a day key. */
function easternDayLabel(dayKey: string): string {
  // Anchor at mid-day UTC so the ET calendar day is unambiguous across DST.
  const [y, m, d] = dayKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 16));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(anchor);
}

/** Map a DB `pipeline_status` to the UI `BadgeStatus` vocabulary (docs/08 §5). */
function toBadgeStatus(status: PipelineStatus): BadgeStatus {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'in_progress':
    case 'awaiting_transcript':
    case 'processing':
      return 'processing';
    case 'complete':
      return 'complete';
    case 'needs_attention':
      return 'needs-review';
    case 'cancelled':
      return 'overdue';
  }
}

/** A meeting needs attention when it's external with no linked org yet (amber). */
function meetingNeedsAttention(m: CalendarMeeting): boolean {
  return !m.isInternal && m.orgs.length === 0;
}

/** Non-internal party types offered when creating an org from a domain. */
const CREATE_ORG_TYPES: ReadonlyArray<{ readonly value: ClientType; readonly label: string }> = [
  { value: 'client', label: 'Client' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'lead', label: 'Lead' },
  { value: 'partner', label: 'Partner' },
];

/** Human label for a party type (chip caption). */
function orgTypeLabel(type: ClientType): string {
  return CREATE_ORG_TYPES.find((t) => t.value === type)?.label ?? 'Internal';
}

/** A short caption of a meeting's org state for the month-grid pill. */
function meetingGridLabel(m: CalendarMeeting): string {
  if (m.isInternal) return 'Internal';
  if (m.orgs.length === 1) return m.orgs[0]?.name ?? 'Meeting';
  if (m.orgs.length > 1) return `${m.orgs.length} clients`;
  if (m.unknownOrgDomains.length > 0) return `${m.unknownOrgDomains[0]} · no client`;
  return m.title ?? 'Meeting';
}

interface GridCell {
  readonly key: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

/** Build the 6×7 month grid (ET-consistent) for the given year/month (0-based). */
function buildMonthGrid(year: number, month: number): { cells: GridCell[]; fromIso: string; toIso: string } {
  const todayKey = easternDayKey(new Date().toISOString());
  const firstAnchor = new Date(Date.UTC(year, month, 1, 16));
  const firstWeekday = firstAnchor.getUTCDay(); // 0=Sun
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const anchor = new Date(Date.UTC(year, month, 1 - firstWeekday + i, 16));
    const key = easternDayKey(anchor.toISOString());
    const [, mm, dd] = key.split('-').map(Number);
    cells.push({
      key,
      dayOfMonth: dd ?? 1,
      inMonth: (mm ?? 1) - 1 === month,
      isToday: key === todayKey,
    });
  }
  // Query window spans the visible grid (full days), a little padded.
  const fromIso = new Date(Date.UTC(year, month, 1 - firstWeekday, 0)).toISOString();
  const toIso = new Date(Date.UTC(year, month, 1 - firstWeekday + 42, 0)).toISOString();
  return { cells, fromIso, toIso };
}

interface MeetingsResponse {
  readonly meetings: readonly CalendarMeeting[];
}
interface ConnectionsResponse {
  readonly status: CalendarConnectionStatus;
}
interface CadenceResponse {
  readonly cadence: readonly ClientCadenceRow[];
}
interface AmbiguousResponse {
  readonly meetings: readonly AmbiguousMeeting[];
  readonly clientOptions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}
interface AutoJoinResponse {
  readonly autoJoinMeetings: boolean;
}
interface CalendarSettingsResponse {
  readonly botDispatchEnabled: boolean;
}

export default function CalendarPage(): React.JSX.Element {
  const { hasRole, canEdit } = useAuth();
  const isAdmin = hasRole('admin');
  const editable = canEdit();

  const nowKey = easternDayKey(new Date().toISOString());
  const [nowY, nowM] = nowKey.split('-').map(Number);
  const [viewYear, setViewYear] = useState<number>(nowY ?? 2026);
  const [viewMonth, setViewMonth] = useState<number>((nowM ?? 1) - 1);
  const [selectedDay, setSelectedDay] = useState<string>(nowKey);

  const [meetings, setMeetings] = useState<readonly CalendarMeeting[] | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  // Bumped after a link/create-org action to refetch the visible window in place.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback((): void => setReloadToken((t) => t + 1), []);

  // GA-member filter (client-side): show only meetings a chosen member is on (as
  // lead or attendee). Options accumulate across visited months so the current
  // selection stays valid while navigating.
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [seenMembers, setSeenMembers] = useState<Map<string, CalendarPerson>>(() => new Map());

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  // Meetings for the visible grid — refetched on month change or after an edit.
  useEffect(() => {
    let active = true;
    setMeetings(null);
    setMeetingsError(null);
    apiClient
      .get<MeetingsResponse>(`/api/calendar?from=${grid.fromIso}&to=${grid.toIso}`)
      .then((data) => {
        if (active) setMeetings(data.meetings);
      })
      .catch((e: unknown) => {
        if (active) setMeetingsError(e instanceof Error ? e.message : 'Failed to load calendar');
      });
    return (): void => {
      active = false;
    };
  }, [grid.fromIso, grid.toIso, reloadToken]);

  // Accumulate the set of GA people seen across visited months for the filter.
  useEffect(() => {
    if (meetings === null) return;
    setSeenMembers((prev) => {
      const next = new Map(prev);
      for (const m of meetings) {
        if (m.lead !== null) next.set(m.lead.id, m.lead);
        for (const a of m.attendees) next.set(a.id, a);
      }
      return next;
    });
  }, [meetings]);

  const memberOptions = useMemo(
    () => [...seenMembers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [seenMembers],
  );

  // Apply the member filter to the loaded window (lead or attendee match).
  const visibleMeetings = useMemo<readonly CalendarMeeting[]>(() => {
    const all = meetings ?? [];
    if (memberFilter === '') return all;
    return all.filter(
      (m) => m.lead?.id === memberFilter || m.attendees.some((a) => a.id === memberFilter),
    );
  }, [meetings, memberFilter]);

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, CalendarMeeting[]>();
    for (const m of visibleMeetings) {
      const key = easternDayKey(m.dateTime);
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [visibleMeetings]);

  const selectedMeetings = useMemo(
    () =>
      [...(meetingsByDay.get(selectedDay) ?? [])].sort(
        (a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime),
      ),
    [meetingsByDay, selectedDay],
  );

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(viewYear, viewMonth, 1)));

  const goToMonth = useCallback((delta: number): void => {
    setViewMonth((prevMonth) => {
      const total = prevMonth + delta;
      const nextMonth = ((total % 12) + 12) % 12;
      setViewYear((prevYear) => prevYear + Math.floor(total / 12));
      return nextMonth;
    });
  }, []);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Calendar</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Every team meeting from Outlook — matched to clients by attendee domain, with unknown
          orgs one click from a new client, lead, or prospect.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Member</span>
          <select
            value={memberFilter}
            onChange={(event): void => setMemberFilter(event.target.value)}
            className="rounded-lg border bg-white px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
            aria-label="Filter meetings by GA member"
          >
            <option value="">All members</option>
            {memberOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        {memberFilter !== '' ? (
          <button
            type="button"
            onClick={(): void => setMemberFilter('')}
            style={{ ...TYPE.label, color: 'var(--color-blue-600)', cursor: 'pointer' }}
          >
            Clear filter
          </button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 style={TYPE.sectionHeader}>{monthLabel}</h2>
              <div className="flex items-center gap-1">
                <IconNavButton label="Previous month" onClick={(): void => goToMonth(-1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </IconNavButton>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setViewYear(nowY ?? 2026);
                    setViewMonth((nowM ?? 1) - 1);
                    setSelectedDay(nowKey);
                  }}
                >
                  Today
                </Button>
                <IconNavButton label="Next month" onClick={(): void => goToMonth(1)}>
                  <ChevronRight size={18} aria-hidden="true" />
                </IconNavButton>
              </div>
            </div>

            {meetingsError !== null ? (
              <ErrorState title="Couldn’t load the calendar" description={meetingsError} />
            ) : (
              <MonthGrid
                grid={grid}
                meetingsByDay={meetingsByDay}
                selectedDay={selectedDay}
                onSelect={setSelectedDay}
                loading={meetings === null}
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <DayDetail
            dayKey={selectedDay}
            meetings={selectedMeetings}
            loading={meetings === null}
            editable={editable}
            onChanged={reload}
          />
          <ConnectionPanel isAdmin={isAdmin} onSynced={reload} />
        </div>
      </div>

      {isAdmin ? <AmbiguousSection /> : null}
      <CadenceSection />
    </section>
  );
}

function IconNavButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-lg border p-1.5"
      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

function MonthGrid({
  grid,
  meetingsByDay,
  selectedDay,
  onSelect,
  loading,
}: {
  readonly grid: { cells: GridCell[] };
  readonly meetingsByDay: ReadonlyMap<string, CalendarMeeting[]>;
  readonly selectedDay: string;
  readonly onSelect: (key: string) => void;
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-1 py-1 text-center" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.cells.map((cell) => {
          const dayMeetings = meetingsByDay.get(cell.key) ?? [];
          const isSelected = cell.key === selectedDay;
          const hasAttention = dayMeetings.some(meetingNeedsAttention);
          return (
            <button
              key={cell.key}
              type="button"
              onClick={(): void => onSelect(cell.key)}
              aria-pressed={isSelected}
              className="flex min-h-[4.5rem] flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors"
              style={{
                borderColor: isSelected ? 'var(--color-blue-500)' : 'var(--border-subtle)',
                backgroundColor: isSelected
                  ? 'var(--color-blue-100)'
                  : cell.inMonth
                    ? '#ffffff'
                    : 'var(--color-slate-100)',
                opacity: cell.inMonth ? 1 : 0.6,
                cursor: 'pointer',
              }}
            >
              <span className="flex items-center justify-between">
                <span
                  className="inline-flex size-6 items-center justify-center rounded-full"
                  style={{
                    ...TYPE.secondary,
                    fontWeight: cell.isToday ? 700 : 500,
                    backgroundColor: cell.isToday ? 'var(--color-blue-500)' : 'transparent',
                    color: cell.isToday ? '#ffffff' : 'var(--text-primary)',
                  }}
                >
                  {cell.dayOfMonth}
                </span>
                {hasAttention ? (
                  <AlertTriangle size={12} aria-label="Needs client assignment" style={{ color: 'var(--color-amber-600)' }} />
                ) : null}
              </span>
              {loading ? null : dayMeetings.length > 0 ? (
                <span className="flex flex-col gap-0.5">
                  {dayMeetings.slice(0, 2).map((m) => {
                    const attention = meetingNeedsAttention(m);
                    const bg = attention
                      ? 'var(--color-amber-100)'
                      : m.isInternal
                        ? 'var(--color-slate-100)'
                        : 'var(--color-blue-100)';
                    const fg = attention
                      ? 'var(--color-amber-600)'
                      : m.isInternal
                        ? 'var(--color-slate-600)'
                        : 'var(--color-blue-700)';
                    return (
                      <span
                        key={m.id}
                        className="truncate rounded px-1"
                        style={{ ...TYPE.label, backgroundColor: bg, color: fg }}
                      >
                        {easternTime(m.dateTime)} {meetingGridLabel(m)}
                      </span>
                    );
                  })}
                  {dayMeetings.length > 2 ? (
                    <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                      +{dayMeetings.length - 2} more
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayDetail({
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
      <CardHeader title={easternDayLabel(dayKey)} description={`${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`} />
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
          <span style={TYPE.bodyStrong}>{m.title ?? 'Untitled meeting'}</span>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{easternTime(m.dateTime)}</span>
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

/** Modal: create a client/lead/prospect/partner from an unknown meeting domain. */
function CreateOrgModal({
  meetingId,
  domain,
  defaultType,
  suggested,
  onClose,
  onCreated,
}: {
  readonly meetingId: string;
  readonly domain: string;
  readonly defaultType: ClientType;
  readonly suggested: ExternalAttendee | null;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}): React.JSX.Element {
  const [name, setName] = useState<string>(deriveOrgNameFromDomain(domain));
  const [type, setType] = useState<ClientType>(defaultType);
  const [contact, setContact] = useState<string>(suggested?.name ?? '');
  const [contactEmail, setContactEmail] = useState<string>(suggested?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback((): void => {
    if (name.trim() === '') {
      setError('A name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meetingId}/create-org`, {
        domain,
        name: name.trim(),
        type,
        primaryContact: contact.trim() || undefined,
        primaryContactEmail: contactEmail.trim() || undefined,
      })
      .then(() => onCreated())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to create org'))
      .finally(() => setSubmitting(false));
  }, [meetingId, domain, name, type, contact, contactEmail, onCreated]);

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create organization"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          New org for <span className="font-data">{domain}</span>. Past and future meetings on this
          domain will link automatically.
        </p>
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Name *</span>
          <input className={inputClass} style={inputStyle} value={name} onChange={(e): void => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Type</span>
          <select
            className={inputClass}
            style={inputStyle}
            value={type}
            onChange={(e): void => setType(e.target.value as ClientType)}
          >
            {CREATE_ORG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Primary contact</span>
            <input className={inputClass} style={inputStyle} value={contact} onChange={(e): void => setContact(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Contact email</span>
            <input
              type="email"
              className={inputClass}
              style={inputStyle}
              value={contactEmail}
              onChange={(e): void => setContactEmail(e.target.value)}
            />
          </label>
        </div>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}

/** Modal: link an existing (non-internal) org to a meeting. */
function LinkExistingModal({
  meetingId,
  linkedIds,
  onClose,
  onLinked,
}: {
  readonly meetingId: string;
  readonly linkedIds: readonly string[];
  readonly onClose: () => void;
  readonly onLinked: () => void;
}): React.JSX.Element {
  const [clients, setClients] = useState<readonly Client[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ clients: readonly Client[] }>('/api/clients?type=all')
      .then((d) => {
        if (active) setClients(d.clients);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load orgs');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const options = (clients ?? []).filter((c) => !linkedIds.includes(c.id));

  const submit = useCallback((): void => {
    if (choice === '') return;
    setSubmitting(true);
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meetingId}/orgs`, { clientId: choice, action: 'link' })
      .then(() => onLinked())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to link org'))
      .finally(() => setSubmitting(false));
  }, [meetingId, choice, onLinked]);

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Link an existing org"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting || choice === ''}>
            {submitting ? 'Linking…' : 'Link'}
          </Button>
        </>
      }
    >
      {loadError !== null ? (
        <ErrorState title="Couldn’t load orgs" description={loadError} />
      ) : clients === null ? (
        <LoadingState label="Loading orgs…" />
      ) : options.length === 0 ? (
        <EmptyState title="No orgs to link" description="Every existing org is already linked, or none exist yet." />
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Organization</span>
            <select
              className={inputClass}
              style={inputStyle}
              value={choice}
              onChange={(e): void => setChoice(e.target.value)}
            >
              <option value="">Select an org…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.type !== 'client' ? ` (${orgTypeLabel(c.type)})` : ''}
                </option>
              ))}
            </select>
          </label>
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

function ConnectionPanel({
  isAdmin,
  onSynced,
}: {
  readonly isAdmin: boolean;
  readonly onSynced?: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ConnectionsResponse>('/api/calendar/connections')
      .then((data) => {
        if (active) setStatus(data.status);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load connection status');
      });
    return (): void => {
      active = false;
    };
  }, []);

  /** Re-fetch connection status; returns the fresh last-synced time. */
  const refreshStatus = useCallback(async (): Promise<string | null> => {
    const data = await apiClient.get<ConnectionsResponse>('/api/calendar/connections');
    setStatus(data.status);
    return data.status.lastSyncedAt;
  }, []);

  /**
   * Trigger a manual scan, then poll until the worker's last-synced time advances
   * (or a ~30s timeout), so the panel + calendar reflect the fresh sweep.
   */
  const onSyncNow = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setSyncNote(null);
    const before = status?.lastSyncedAt ?? null;
    try {
      await apiClient.post('/api/calendar/sync', {});
    } catch (e: unknown) {
      setSyncNote(e instanceof Error ? e.message : 'Could not start sync');
      setSyncing(false);
      return;
    }
    let done = false;
    for (let i = 0; i < 10 && !done; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      try {
        const after = await refreshStatus();
        if (after !== before) done = true;
      } catch {
        // transient — keep polling until the timeout
      }
    }
    setSyncNote(done ? 'Calendar synced.' : 'Sync started — results will appear shortly.');
    if (done) onSynced?.();
    setSyncing(false);
  }, [status, refreshStatus, onSynced]);

  return (
    <Card>
      <CardHeader
        title="Calendar Connection"
        description={
          status === null
            ? undefined
            : status.groupConfigured
              ? status.lastSyncedAt !== null
                ? `Last synced ${formatEasternDateTime(status.lastSyncedAt)}`
                : 'Connected'
              : 'Not yet synced'
        }
      />
      {error !== null ? (
        <ErrorState title="Couldn’t load connections" description={error} />
      ) : status === null ? (
        <LoadingState label="Loading connection status…" />
      ) : (
        <div className="flex flex-col gap-3">
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={syncing}
                onClick={(): void => {
                  void onSyncNow();
                }}
                icon={
                  <RefreshCw
                    size={14}
                    aria-hidden="true"
                    className={syncing ? 'animate-spin' : undefined}
                  />
                }
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
              {syncNote !== null ? (
                <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{syncNote}</span>
              ) : null}
            </div>
          ) : null}
          {!status.groupConfigured ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              The calendar scan has not run yet. Connection status appears once the worker syncs
              access-group membership.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {status.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: member.isConnected ? 'var(--color-emerald-500)' : 'var(--color-slate-500)' }}
                />
                <span className="flex min-w-0 flex-col">
                  <span style={TYPE.bodyStrong} className="truncate">
                    {member.name}
                  </span>
                  <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }} className="truncate">
                    {member.email}
                  </span>
                </span>
                <span
                  className="ml-auto"
                  style={{ ...TYPE.label, color: member.isConnected ? 'var(--color-emerald-600)' : 'var(--text-secondary)' }}
                >
                  {member.isConnected ? 'Connected' : 'Offline'}
                </span>
              </li>
            ))}
          </ul>
          {isAdmin ? null : (
            <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              You see your own connection status. Admins see the whole team.
            </p>
          )}
          {isAdmin ? <BotDispatchToggle /> : null}
          <AutoJoinToggle />
        </div>
      )}
    </Card>
  );
}

/**
 * Admin-only master switch for the P4 meeting bot. When off, the worker joins
 * NO meetings team-wide, regardless of anyone's per-user preference — the global
 * kill-switch (fail-safe OFF by default). Non-admins never see this control.
 */
function BotDispatchToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<CalendarSettingsResponse>('/api/calendar/settings')
      .then((data) => {
        if (active) setEnabled(data.botDispatchEnabled);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const onToggle = useCallback(
    (next: boolean): void => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setNote(null);
      apiClient
        .patch<CalendarSettingsResponse>('/api/calendar/settings', { enabled: next })
        .then((data) => setEnabled(data.botDispatchEnabled))
        .catch((e: unknown) => {
          setEnabled(previous);
          setNote(e instanceof Error ? e.message : 'Could not save setting');
        })
        .finally(() => setSaving(false));
    },
    [enabled],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>Auto-join meetings (global)</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        Master switch for the whole team. When off, the meeting bot won’t join any
        meeting, regardless of per-user settings.
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function AutoJoinToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<AutoJoinResponse>('/api/calendar/auto-join')
      .then((data) => {
        if (active) setEnabled(data.autoJoinMeetings);
      })
      .catch(() => {
        if (active) setEnabled(true);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const onToggle = useCallback(
    (next: boolean): void => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setNote(null);
      apiClient
        .patch<AutoJoinResponse>('/api/calendar/auto-join', { enabled: next })
        .then((data) => setEnabled(data.autoJoinMeetings))
        .catch((e: unknown) => {
          setEnabled(previous);
          setNote(e instanceof Error ? e.message : 'Could not save preference');
        })
        .finally(() => setSaving(false));
    },
    [enabled],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled ?? true}
          disabled={enabled === null || saving}
          onChange={(event): void => onToggle(event.target.checked)}
          className="size-4 rounded border"
          style={{ borderColor: 'var(--border-subtle)', accentColor: 'var(--color-blue-500)' }}
        />
        <span style={TYPE.body}>Auto-join meetings I lead</span>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        When off, the meeting bot won’t auto-join meetings where you’re the lead.
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function AmbiguousSection(): React.JSX.Element {
  const [data, setData] = useState<AmbiguousResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback((): void => {
    setError(null);
    apiClient
      .get<AmbiguousResponse>('/api/calendar/ambiguous')
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load ambiguous meetings'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const assign = useCallback(
    (meetingId: string): void => {
      const clientId = choice[meetingId];
      if (clientId === undefined || clientId === '') return;
      setAssigning(meetingId);
      apiClient
        .post('/api/calendar/assign', { meetingId, clientId })
        .then(() => load())
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to assign client'))
        .finally(() => setAssigning(null));
    },
    [choice, load],
  );

  return (
    <Card accent={data !== null && data.meetings.length > 0 ? 'critical' : 'none'}>
      <CardHeader
        title="Needs client assignment"
        description="Meetings with no linked client or an unrecognized org domain. Assign a client to queue the bot, or create the org from the meeting."
      />
      {error !== null ? (
        <ErrorState title="Couldn’t load" description={error} />
      ) : data === null ? (
        <LoadingState label="Loading…" />
      ) : data.meetings.length === 0 ? (
        <EmptyState title="Nothing to assign" description="No ambiguous meetings. Matches are resolving cleanly." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.meetings.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span style={TYPE.bodyStrong}>{m.title ?? 'Untitled meeting'}</span>
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {formatEasternDateTime(m.dateTime)}
                  {m.attendees.length > 0 ? ` · ${m.attendees.map((p) => p.name).join(', ')}` : ''}
                </span>
                {m.unknownOrgDomains.length > 0 ? (
                  <span className="font-data" style={{ ...TYPE.label, color: 'var(--color-amber-600)' }}>
                    Unknown: {m.unknownOrgDomains.join(', ')}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={choice[m.id] ?? ''}
                  onChange={(event): void => setChoice((prev) => ({ ...prev, [m.id]: event.target.value }))}
                  className="rounded-lg border bg-white px-3 py-2"
                  style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
                  aria-label={`Assign a client to ${m.title ?? 'meeting'}`}
                >
                  <option value="">Select client…</option>
                  {data.clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={assigning === m.id || (choice[m.id] ?? '') === ''}
                  onClick={(): void => assign(m.id)}
                >
                  {assigning === m.id ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CadenceSection(): React.JSX.Element {
  const [rows, setRows] = useState<readonly ClientCadenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<CadenceResponse>('/api/calendar/cadence')
      .then((data) => {
        if (active) setRows(data.cadence);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load cadence');
      });
    return (): void => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader
        title="Cadence tracker"
        description="Meeting rhythm per client — last meeting, next scheduled, and overdue flags."
        icon={<RefreshCw size={18} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />}
      />
      {error !== null ? (
        <ErrorState title="Couldn’t load cadence" description={error} />
      ) : rows === null ? (
        <LoadingState label="Loading cadence…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No clients" description="Cadence appears once clients and meetings exist." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                <th className="px-2 py-1 text-left">Client</th>
                <th className="px-2 py-1 text-left">Cadence</th>
                <th className="px-2 py-1 text-left">Last meeting</th>
                <th className="px-2 py-1 text-left">Next meeting</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.clientId} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2 py-2" style={TYPE.bodyStrong}>
                    {row.clientName}
                  </td>
                  <td className="px-2 py-2" style={{ ...TYPE.secondary, textTransform: 'capitalize' }}>
                    {row.cadence.replace('_', ' ')}
                  </td>
                  <td className="px-2 py-2" style={TYPE.secondary}>
                    {row.lastMeetingAt !== null ? formatEasternDateTime(row.lastMeetingAt) : '—'}
                  </td>
                  <td className="px-2 py-2" style={TYPE.secondary}>
                    {row.nextMeetingAt !== null ? formatEasternDateTime(row.nextMeetingAt) : '—'}
                  </td>
                  <td className="px-2 py-2">
                    {row.isOverdue ? (
                      <Badge bg="var(--color-red-100)" fg="var(--color-red-600)">
                        Overdue
                      </Badge>
                    ) : (
                      <Badge bg="var(--color-emerald-100)" fg="var(--color-emerald-600)">
                        On track
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
