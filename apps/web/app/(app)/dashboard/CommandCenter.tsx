import Link from 'next/link';
import { CalendarClock, FileText, Sunrise } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { easternDateString, getDailySync } from '@/lib/data/daily-sync';
import { todayEastern } from '@/lib/format';
import { getSessionUser } from '@/lib/session-user';
import { TYPE } from '@/lib/typography';
import type { DailySyncBrief, DailySyncContent, DailySyncMeeting } from '@gracie/shared';

const ET = 'America/New_York';

/** Clock label for a meeting start, in the viewer's profile zone (null → Eastern). */
function clockTime(iso: string, zone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone ?? ET,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** Muted single-line empty state for a tile body (no nested card border). */
function TileEmpty({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{children}</p>;
}

/** Header-right "→" link shared by the tiles. */
function TileLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="shrink-0"
      style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}
    >
      {label} →
    </Link>
  );
}

/** Daily Sync tile — the whole card links through to /daily-sync. */
function DailySyncBanner({
  content,
}: {
  readonly content: DailySyncContent | null;
}): React.JSX.Element {
  const summary =
    content !== null
      ? `${content.todayMeetings.length} meeting${content.todayMeetings.length === 1 ? '' : 's'} today · ` +
        `${content.briefs.length} brief${content.briefs.length === 1 ? '' : 's'} · ` +
        `${content.atRiskClients.length} client${content.atRiskClients.length === 1 ? '' : 's'} to watch`
      : 'Today’s briefing generates around 6:00 AM Eastern.';

  return (
    <Link href="/daily-sync" className="block rounded-lg transition-opacity hover:opacity-90">
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
          <span className="shrink-0" style={{ ...TYPE.bodyStrong, color: 'var(--color-blue-700)' }}>
            View →
          </span>
        </div>
      </Card>
    </Link>
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
              <li
                key={m.meetingId}
                className="border-b last:border-0"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
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

/** Tile 2 — today's pre-meeting briefs, each linking to its meeting occurrence page. */
function PreMeetingBriefsTile({
  briefs,
}: {
  readonly briefs: readonly DailySyncBrief[];
}): React.JSX.Element {
  const shown = briefs.slice(0, 6);
  return (
    <Card>
      <CardHeader
        title="Pre-meeting briefs"
        icon={<FileText size={20} aria-hidden="true" />}
        action={<TileLink href="/daily-sync" label="Daily Sync" />}
      />
      {shown.length > 0 ? (
        <ul>
          {shown.map((b) => (
            <li
              key={b.meetingId}
              className="border-b last:border-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <Link
                href={`/meetings/${b.meetingId}`}
                className="flex flex-col gap-0.5 py-2 hover:underline"
              >
                <span style={TYPE.bodyStrong} className="truncate">
                  {b.title}
                </span>
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {b.clientName ?? 'Internal'} · brief ready
                </span>
              </Link>
            </li>
          ))}
          {briefs.length > shown.length ? (
            <li className="pt-2">
              <TileEmpty>+{briefs.length - shown.length} more today</TileEmpty>
            </li>
          ) : null}
        </ul>
      ) : (
        <TileEmpty>No briefs for today&rsquo;s meetings yet.</TileEmpty>
      )}
    </Card>
  );
}

/**
 * Daily Command Center tiles (docs/08 §8 M1). Extracted from the Overview page so
 * the same command-center is reused on the assistant landing.
 *
 * - `variant="grid"` (Overview page): page header + 2-across grid on `lg`+.
 * - `variant="rail"` (assistant landing): a narrow single-column stack that sits
 *   beside the chat — the page header is dropped (the chat owns the landing). The
 *   home page bounds this rail's height and lets it scroll on its own.
 */
export async function CommandCenter({
  variant = 'grid',
}: {
  readonly variant?: 'grid' | 'rail';
}): Promise<React.JSX.Element> {
  // Both sources are loaded best-effort: one read blip must never turn the landing
  // page into a 500. A failed source degrades to its own tile's empty state.
  const [sync, viewer] = await Promise.all([
    getDailySync(easternDateString(new Date())).catch(() => null),
    getSessionUser().catch(() => null),
  ]);

  const content = sync?.content ?? null;
  const meetings = content?.todayMeetings ?? [];
  const briefs = content?.briefs ?? [];

  const rail = variant === 'rail';
  return (
    <div className={`flex flex-col ${rail ? 'gap-4' : 'gap-6'}`}>
      <DailySyncBanner content={content} />
      {rail ? null : (
        <header className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Daily Command Center</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {todayEastern(viewer?.timezone)}
          </p>
        </header>
      )}
      <div className={rail ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 gap-6 lg:grid-cols-2'}>
        <TodayMeetingsTile meetings={meetings} timeZone={viewer?.timezone} />
        <PreMeetingBriefsTile briefs={briefs} />
      </div>
    </div>
  );
}
