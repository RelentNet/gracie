'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import type { CalendarMeeting, CalendarPerson } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/PageContainer';
import { ErrorState } from '@/components/ui/StateViews';

import {
  buildMonthGrid,
  buildWeekGrid,
  localDayKey,
  shiftDayKey,
  weekRangeLabel,
} from './lib/calendar-dates';
import type { ManualJoinStateResponse, MeetingsResponse } from './types';
import { MonthGrid } from './components/MonthGrid';
import { WeekView } from './components/WeekView';
import { DayDetail } from './components/DayDetail';
import { ConnectionPanel } from './components/ConnectionPanel';
import { AmbiguousSection } from './components/AmbiguousSection';
import { CadenceSection } from './components/CadenceSection';
import { JoinMeetingModal } from './components/JoinMeetingModal';

/**
 * Module 7 — Calendar (docs/08 §M7). Real data via `GET /api/calendar*`.
 *
 * Layout: a month grid + day-detail sidebar (left/main), a connection-status
 * panel with the per-user auto-join opt-out (right), an Admin-only ambiguous-
 * meeting pointer, and a per-client cadence tracker.
 *
 * Meetings, matching, dedup, and bot dispatch are all produced by the P4 worker
 * crons (Microsoft Graph → `meetings`); this page is read-mostly. The only writes
 * are the "assign a client" action on a meeting card and the auto-join toggle.
 *
 * The presentational pieces live in `./components`; pure date/meeting helpers in
 * `./lib`; API response shapes in `./types`.
 */
export default function CalendarPage(): React.JSX.Element {
  const { can, canEdit } = useAuth();
  // The calendar admin controls (connection admin view, ambiguous pointer) gate on
  // the dedicated `calendar.configure` permission (admin-tier — behaviour is
  // identical to the prior hasRole('admin')).
  const isAdmin = can('calendar.configure');
  const editable = canEdit();

  const nowKey = localDayKey(new Date().toISOString());
  const [nowY, nowM] = nowKey.split('-').map(Number);
  const [viewYear, setViewYear] = useState<number>(nowY ?? 2026);
  const [viewMonth, setViewMonth] = useState<number>((nowM ?? 1) - 1);
  const [selectedDay, setSelectedDay] = useState<string>(nowKey);
  const [view, setView] = useState<'month' | 'week'>('month');

  const [meetings, setMeetings] = useState<readonly CalendarMeeting[] | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  // Bumped after a link/create-org action to refetch the visible window in place.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback((): void => setReloadToken((t) => t + 1), []);

  // On-demand meeting join (P4.2). The master switch (any user may READ it) gates
  // whether the "Join a meeting" control appears; Admins flip it in Settings.
  const [manualJoinEnabled, setManualJoinEnabled] = useState<boolean | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ManualJoinStateResponse>('/api/calendar/manual-join')
      .then((d) => {
        if (active) setManualJoinEnabled(d.enabled);
      })
      .catch(() => {
        if (active) setManualJoinEnabled(false);
      });
    return (): void => {
      active = false;
    };
  }, []);

  // GA-member filter (client-side): show only meetings a chosen member is on (as
  // lead or attendee). Options accumulate across visited months so the current
  // selection stays valid while navigating.
  const [memberFilter, setMemberFilter] = useState<string>('');
  const [seenMembers, setSeenMembers] = useState<Map<string, CalendarPerson>>(() => new Map());

  const monthGrid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  // Week view is anchored on the selected day (the week that contains it).
  const weekGrid = useMemo(() => buildWeekGrid(selectedDay), [selectedDay]);
  // Same fetch, different window: month grid span vs. the 7-day week.
  const range = view === 'week' ? weekGrid : monthGrid;

  // Meetings for the visible range — refetched on range change or after an edit.
  useEffect(() => {
    let active = true;
    setMeetings(null);
    setMeetingsError(null);
    apiClient
      .get<MeetingsResponse>(`/api/calendar?from=${range.fromIso}&to=${range.toIso}`)
      .then((data) => {
        if (active) setMeetings(data.meetings);
      })
      .catch((e: unknown) => {
        if (active) setMeetingsError(e instanceof Error ? e.message : 'Failed to load calendar');
      });
    return (): void => {
      active = false;
    };
  }, [range.fromIso, range.toIso, reloadToken]);

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
      const key = localDayKey(m.dateTime);
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
  const headerLabel =
    view === 'week'
      ? weekRangeLabel(weekGrid.cells[0]?.key ?? selectedDay, weekGrid.cells[6]?.key ?? selectedDay)
      : monthLabel;

  const goToMonth = useCallback((delta: number): void => {
    setViewMonth((prevMonth) => {
      const total = prevMonth + delta;
      const nextMonth = ((total % 12) + 12) % 12;
      setViewYear((prevYear) => prevYear + Math.floor(total / 12));
      return nextMonth;
    });
  }, []);

  // Week nav shifts the selected day by whole weeks; keep the month state in sync
  // so toggling back to Month lands on the same period.
  const goToWeek = useCallback((delta: number): void => {
    setSelectedDay((prev) => {
      const next = shiftDayKey(prev, delta * 7);
      const [y, mo] = next.split('-').map(Number);
      if (y !== undefined && mo !== undefined) {
        setViewYear(y);
        setViewMonth(mo - 1);
      }
      return next;
    });
  }, []);

  const goToday = useCallback((): void => {
    setViewYear(nowY ?? 2026);
    setViewMonth((nowM ?? 1) - 1);
    setSelectedDay(nowKey);
  }, [nowKey, nowY, nowM]);

  // Navigate the whole view (month + selected day) to a given day key — used by
  // the "needs a client" pointer to jump to the earliest such meeting's day.
  const jumpToDay = useCallback((dayKey: string): void => {
    const [y, mo] = dayKey.split('-').map(Number);
    if (y !== undefined && mo !== undefined) {
      setViewYear(y);
      setViewMonth(mo - 1);
    }
    setSelectedDay(dayKey);
  }, []);

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Calendar</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Every team meeting from Outlook — matched to clients by attendee domain, with unknown orgs
          one click from a new client, lead, or prospect.
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
        {manualJoinEnabled === true ? (
          <Button
            className="ml-auto"
            variant="primary"
            size="sm"
            icon={<Video size={14} aria-hidden="true" />}
            onClick={(): void => setJoinOpen(true)}
          >
            Join a meeting
          </Button>
        ) : null}
      </div>

      {joinOpen ? (
        <JoinMeetingModal
          onClose={(): void => setJoinOpen(false)}
          onJoined={(): void => {
            setJoinOpen(false);
            reload();
          }}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 style={TYPE.sectionHeader}>{headerLabel}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <ViewToggle view={view} onChange={setView} />
                <div className="flex items-center gap-1">
                  <IconNavButton
                    label={view === 'week' ? 'Previous week' : 'Previous month'}
                    onClick={(): void => (view === 'week' ? goToWeek(-1) : goToMonth(-1))}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </IconNavButton>
                  <Button variant="secondary" size="sm" onClick={goToday}>
                    Today
                  </Button>
                  <IconNavButton
                    label={view === 'week' ? 'Next week' : 'Next month'}
                    onClick={(): void => (view === 'week' ? goToWeek(1) : goToMonth(1))}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </IconNavButton>
                </div>
              </div>
            </div>

            {meetingsError !== null ? (
              <ErrorState title="Couldn’t load the calendar" description={meetingsError} />
            ) : view === 'week' ? (
              <WeekView
                cells={weekGrid.cells}
                meetingsByDay={meetingsByDay}
                selectedDay={selectedDay}
                onSelect={setSelectedDay}
                loading={meetings === null}
              />
            ) : (
              <MonthGrid
                grid={monthGrid}
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
            canRedispatch={isAdmin && manualJoinEnabled === true}
            onChanged={reload}
          />
          <ConnectionPanel isAdmin={isAdmin} onSynced={reload} />
        </div>
      </div>

      {isAdmin ? <AmbiguousSection onJump={jumpToDay} /> : null}
      <CadenceSection />
    </PageContainer>
  );
}

/** Month / Week segmented toggle (same tablist styling as the Clients party tabs). */
function ViewToggle({
  view,
  onChange,
}: {
  readonly view: 'month' | 'week';
  readonly onChange: (v: 'month' | 'week') => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Calendar view">
      {(['month', 'week'] as const).map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={(): void => onChange(v)}
            className="rounded-lg border px-3 py-1.5 capitalize transition-colors"
            style={{
              borderColor: active ? 'var(--color-blue-500)' : 'var(--border-subtle)',
              backgroundColor: active ? 'var(--color-blue-100)' : '#ffffff',
              color: active ? 'var(--color-blue-700)' : 'var(--text-secondary)',
              ...TYPE.bodyStrong,
              cursor: 'pointer',
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
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
      style={{
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
