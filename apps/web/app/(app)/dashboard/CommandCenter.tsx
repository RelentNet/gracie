import Link from 'next/link';
import { AlertTriangle, CalendarClock, FileText, ListChecks, Sunrise } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { taskUrgency } from '@/lib/client-display';
import { easternDateString, getDailySync } from '@/lib/data/daily-sync';
import { listPipelineFleet, type FleetRowView } from '@/lib/data/pipeline';
import { listTasks } from '@/lib/data/tasks';
import { todayEastern } from '@/lib/format';
import { getSessionUser } from '@/lib/session-user';
import { TYPE } from '@/lib/typography';
import type { DailySyncContent, DailySyncMeeting, Task } from '@gracie/shared';

const ET = 'America/New_York';

/** Clock label for a meeting start, in the viewer's profile zone (null → Eastern). */
function clockTime(iso: string, zone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone ?? ET, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Compact ET due-date label for a `YYYY-MM-DD` (noon-anchored to dodge the TZ rollback). */
function dueLabel(dueDate: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, month: 'short', day: 'numeric' }).format(
    new Date(`${dueDate}T12:00:00Z`),
  );
}

/** Muted single-line empty state for a tile body (no nested card border). */
function TileEmpty({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{children}</p>;
}

/** Header-right "→" link shared by the tiles. */
function TileLink({ href, label }: { readonly href: string; readonly label: string }): React.JSX.Element {
  return (
    <Link href={href} className="shrink-0" style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}>
      {label} →
    </Link>
  );
}

/** Daily Sync banner (unchanged behaviour; content now flows in from the page). */
function DailySyncBanner({ content }: { readonly content: DailySyncContent | null }): React.JSX.Element {
  const summary =
    content !== null
      ? `${content.todayMeetings.length} meeting${content.todayMeetings.length === 1 ? '' : 's'} today · ` +
        `${content.briefs.length} brief${content.briefs.length === 1 ? '' : 's'} · ` +
        `${content.atRiskClients.length} client${content.atRiskClients.length === 1 ? '' : 's'} to watch`
      : 'Today’s briefing generates around 6:00 AM Eastern.';

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--color-navy-800)', color: '#ffffff' }}
          >
            <Sunrise size={20} aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <span style={TYPE.sectionHeader}>Daily Sync</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{summary}</span>
          </div>
        </div>
        <Link
          href="/daily-sync"
          className="shrink-0 rounded-lg px-3 py-2"
          style={{ ...TYPE.bodyStrong, color: 'var(--color-blue-700)' }}
        >
          View →
        </Link>
      </div>
    </Card>
  );
}

/** Tile 1 — today's meetings, each linking to its occurrence page. */
function TodayMeetingsTile({
  meetings,
  timeZone,
}: {
  readonly meetings: readonly DailySyncMeeting[];
  readonly timeZone?: string | null;
}): React.JSX.Element {
  const shown = meetings.slice(0, 6);
  return (
    <Card>
      <CardHeader
        title="Today's meetings"
        icon={<CalendarClock size={20} aria-hidden="true" />}
        action={<TileLink href="/calendar" label="Calendar" />}
      />
      {shown.length > 0 ? (
        <ul>
          {shown.map((m) => {
            const who = m.isInternal ? 'Internal' : (m.clientName ?? 'Unassigned');
            return (
              <li key={m.meetingId} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                <Link
                  href={`/meetings/${m.meetingId}`}
                  className="flex items-center justify-between gap-3 py-2 hover:underline"
                >
                  <span className="flex min-w-0 flex-col">
                    <span style={TYPE.bodyStrong} className="truncate">
                      {m.title}
                    </span>
                    <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                      {clockTime(m.timeIso, timeZone)} · {who}
                      {m.leadName !== null ? ` · lead ${m.leadName}` : ''}
                    </span>
                  </span>
                  {m.hasBrief ? (
                    <Badge
                      bg="var(--color-slate-100)"
                      fg="var(--text-secondary)"
                      icon={<FileText size={11} aria-hidden="true" />}
                    >
                      Brief
                    </Badge>
                  ) : null}
                </Link>
              </li>
            );
          })}
          {meetings.length > shown.length ? (
            <li className="pt-2">
              <TileEmpty>+{meetings.length - shown.length} more today</TileEmpty>
            </li>
          ) : null}
        </ul>
      ) : (
        <TileEmpty>No meetings today.</TileEmpty>
      )}
    </Card>
  );
}

/** Tile 2 — the viewer's own open tasks, soonest due first. */
function MyTasksTile({ tasks }: { readonly tasks: readonly Task[] }): React.JSX.Element {
  const now = new Date();
  const shown = tasks.slice(0, 5);
  return (
    <Card>
      <CardHeader
        title="My open tasks"
        icon={<ListChecks size={20} aria-hidden="true" />}
        action={<TileLink href="/tasks" label="Task Board" />}
      />
      {shown.length > 0 ? (
        <ul>
          {shown.map((t) => {
            const urgency = taskUrgency(t.dueDate, false, now);
            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <span style={TYPE.bodyStrong} className="min-w-0 flex-1 truncate">
                  {t.description}
                </span>
                {t.dueDate !== null ? (
                  <span
                    className="shrink-0"
                    style={{
                      ...TYPE.secondary,
                      color: urgency === 'overdue' ? 'var(--color-red-600)' : 'var(--text-secondary)',
                    }}
                  >
                    {urgency === 'overdue' ? 'Overdue · ' : ''}
                    {dueLabel(t.dueDate)}
                  </span>
                ) : (
                  <span className="shrink-0" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                    No due date
                  </span>
                )}
              </li>
            );
          })}
          {tasks.length > shown.length ? (
            <li className="pt-2">
              <TileEmpty>+{tasks.length - shown.length} more assigned to you</TileEmpty>
            </li>
          ) : null}
        </ul>
      ) : (
        <TileEmpty>No open tasks assigned to you.</TileEmpty>
      )}
    </Card>
  );
}

/** Tile 3 — pipeline runs/meetings that are stuck and need a human. */
function NeedsAttentionTile({ rows }: { readonly rows: readonly FleetRowView[] }): React.JSX.Element {
  const shown = rows.slice(0, 4);
  return (
    <Card accent={rows.length > 0 ? 'critical' : 'none'}>
      <CardHeader
        title="Needs attention"
        description={
          rows.length > 0
            ? `${rows.length} meeting${rows.length === 1 ? '' : 's'} need a look.`
            : 'Meeting note generation is healthy.'
        }
        icon={<AlertTriangle size={20} aria-hidden="true" />}
        action={<TileLink href="/pipeline" label="Pipeline" />}
      />
      {shown.length > 0 ? (
        <ul>
          {shown.map((r) => {
            const href = r.meetingId !== null ? `/meetings/${r.meetingId}` : '/pipeline';
            return (
              <li key={r.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                <Link href={href} className="flex flex-col gap-0.5 py-2 hover:underline">
                  <span style={TYPE.bodyStrong} className="truncate">
                    {r.title ?? 'Untitled meeting'}
                    {r.client !== null ? ` · ${r.client}` : ''}
                  </span>
                  <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{r.reason.headline}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <TileEmpty>Everything is running smoothly.</TileEmpty>
      )}
    </Card>
  );
}

/**
 * Daily Command Center tiles (docs/08 §8 M1). Extracted from the Overview page so
 * the same command-center is reused on the assistant landing.
 *
 * - `variant="grid"` (Overview page): page header + 3-across grid on `lg`+.
 * - `variant="rail"` (assistant landing): a narrow single-column stack that sits
 *   beside the chat — the page header is dropped (the chat owns the landing).
 */
export async function CommandCenter({
  variant = 'grid',
}: {
  readonly variant?: 'grid' | 'rail';
}): Promise<React.JSX.Element> {
  // Every source is loaded best-effort: one read blip must never turn the landing
  // page into a 500. A failed source degrades to its own tile's empty state.
  const [sync, viewer, allTasks, fleet] = await Promise.all([
    getDailySync(easternDateString(new Date())).catch(() => null),
    getSessionUser().catch(() => null),
    listTasks().catch((): Task[] => []),
    // preflight:false → skip the per-row live Recall calls the Pipeline page makes;
    // the tile only needs states + plain-language reasons, not recovery buttons.
    listPipelineFleet(50, { preflight: false }).catch((): FleetRowView[] => []),
  ]);

  const content = sync?.content ?? null;
  const meetings = content?.todayMeetings ?? [];
  // listTasks() is firm-wide; scope to the viewer here (no per-owner data fn exists).
  const myTasks =
    viewer !== null ? allTasks.filter((t) => t.status === 'open' && t.ownerUserId === viewer.id) : [];
  const attention = fleet.filter((r) => r.state === 'needs_attention' || r.state === 'failed');

  const rail = variant === 'rail';
  return (
    <div className={`flex flex-col ${rail ? 'gap-4' : 'gap-6'}`}>
      <DailySyncBanner content={content} />
      {rail ? null : (
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Daily Command Center</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{todayEastern(viewer?.timezone)}</p>
        </header>
      )}
      <div className={rail ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 gap-6 lg:grid-cols-3'}>
        <TodayMeetingsTile meetings={meetings} timeZone={viewer?.timezone} />
        <MyTasksTile tasks={myTasks} />
        <NeedsAttentionTile rows={attention} />
      </div>
    </div>
  );
}
