import { AlertTriangle, CalendarClock, FileText } from 'lucide-react';

import type { DailySyncContent, DailySyncMeeting } from '@gracie/shared';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { Markdown } from '@/components/ui/Markdown';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/StateViews';
import { easternDateString, getDailySync, type DailySyncRecord } from '@/lib/data/daily-sync';
import { getHealthScoresVisible } from '@/lib/data/scoring-settings';
import { formatEasternDate, formatEasternDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/server-auth';
import { TYPE } from '@/lib/typography';

import { GenerateSyncButton } from './GenerateSyncButton';

const ET = 'America/New_York';

/** Long ET date label from a YYYY-MM-DD (anchored at noon UTC to avoid TZ slip). */
function longEtDate(dateStr: string): string {
  return formatEasternDate(`${dateStr}T12:00:00Z`);
}

/** ET clock label for a meeting start. */
function etTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Health badge colors by band. */
function healthBadge(health: number | null): { bg: string; fg: string; label: string } {
  if (health === null) return { bg: 'var(--color-slate-100)', fg: 'var(--text-secondary)', label: 'n/a' };
  if (health >= 67) return { bg: '#dcfce7', fg: '#166534', label: `${health}` };
  if (health >= 34) return { bg: '#fef3c7', fg: '#92400e', label: `${health}` };
  return { bg: '#fee2e2', fg: '#991b1b', label: `${health}` };
}

/** One stat tile in the yesterday rollup. */
function Stat({ label, value }: { readonly label: string; readonly value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div style={{ ...TYPE.sectionHeaderLg, color: 'var(--color-navy-900)' }}>{value}</div>
      <div style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

/** A single today's-meeting row. */
function MeetingRow({ m }: { readonly m: DailySyncMeeting }): React.JSX.Element {
  const who = m.isInternal ? 'Internal' : (m.clientName ?? 'Unassigned');
  return (
    <li
      className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span className="flex min-w-0 flex-col">
        <span style={TYPE.bodyStrong} className="truncate">
          {m.title}
        </span>
        <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          {etTime(m.timeIso)} · {who}
          {m.leadName !== null ? ` · lead ${m.leadName}` : ''}
        </span>
      </span>
      {m.hasBrief ? (
        <Badge bg="var(--color-slate-100)" fg="var(--text-secondary)" icon={<FileText size={11} aria-hidden="true" />}>
          Brief
        </Badge>
      ) : null}
    </li>
  );
}

/**
 * Render today's morning sync. Server component. Empty cards are omitted; a fully
 * quiet day collapses to a single friendly line. The "Clients to watch" card is
 * also gated on `showHealth` (the platform-wide health-scores toggle, #82).
 */
function DailySyncView({
  record,
  dateLabel,
  showHealth,
}: {
  readonly record: DailySyncRecord | null;
  readonly dateLabel: string;
  readonly showHealth: boolean;
}): React.JSX.Element {
  const content: DailySyncContent | null = record?.content ?? null;
  if (content === null) {
    return (
      <EmptyState
        title={`No sync for ${dateLabel}`}
        description="The morning briefing is generated ~6:00 AM Eastern. It will appear here once the daily-sync job runs for this day."
      />
    );
  }

  const y = content.yesterday;
  const delivered = record?.deliveredAt ?? null;
  const hasYesterday = y.meetingsProcessed + y.documentsGenerated + y.tasksCreated + y.tasksCompleted > 0;
  const hasMeetings = content.todayMeetings.length > 0;
  const hasAtRisk = showHealth && content.atRiskClients.length > 0;
  const hasBriefs = content.briefs.length > 0;
  const quiet = !hasYesterday && !hasMeetings && !hasAtRisk && !hasBriefs;

  return (
    <div className="flex flex-col gap-4">
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        {record?.generatedAt !== null && record?.generatedAt !== undefined
          ? `Generated ${formatEasternDateTime(record.generatedAt)}`
          : 'Generated —'}
        {delivered !== null ? ` · Emailed staff ${formatEasternDateTime(delivered)}` : ' · Not yet emailed'}
      </p>

      {quiet ? <p style={TYPE.body}>Quiet day — nothing scheduled.</p> : null}

      {hasYesterday ? (
        <Card>
          <CardHeader title="Yesterday's activity" description="Activity across the workspace." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Meetings processed" value={y.meetingsProcessed} />
            <Stat label="Documents" value={y.documentsGenerated} />
            <Stat label="Tasks created" value={y.tasksCreated} />
            <Stat label="Tasks completed" value={y.tasksCompleted} />
          </div>
        </Card>
      ) : null}

      {hasMeetings ? (
        <Card>
          <CardHeader title="Today's meetings" icon={<CalendarClock size={20} aria-hidden="true" />} />
          <ul>
            {content.todayMeetings.map((m) => (
              <MeetingRow key={m.meetingId} m={m} />
            ))}
          </ul>
        </Card>
      ) : null}

      {hasAtRisk ? (
        <Card accent="critical">
          <CardHeader
            title="Clients to watch"
            description="Low or declining relationship health."
            icon={<AlertTriangle size={20} aria-hidden="true" />}
          />
          <ul>
            {content.atRiskClients.map((c) => {
              const badge = healthBadge(c.health);
              return (
                <li
                  key={c.clientId}
                  className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span style={TYPE.bodyStrong}>{c.name}</span>
                  <span className="flex items-center gap-2">
                    {c.trend !== null ? (
                      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{c.trend}</span>
                    ) : null}
                    <Badge bg={badge.bg} fg={badge.fg}>
                      health {badge.label}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {hasBriefs ? (
        <Card>
          <CardHeader title="Pre-meeting briefs" description="Context for today's client meetings." />
          <div className="flex flex-col gap-2">
            {content.briefs.map((b) => (
              <details
                key={b.meetingId}
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <summary className="cursor-pointer">
                  <span style={TYPE.bodyStrong}>
                    {b.title}
                    {b.clientName !== null ? ` · ${b.clientName}` : ''}
                  </span>{' '}
                  <Badge
                    bg="var(--color-slate-100)"
                    fg="var(--text-secondary)"
                    icon={<FileText size={11} aria-hidden="true" />}
                  >
                    Brief
                  </Badge>
                </summary>
                <div className="mt-2">
                  <Markdown content={b.content} />
                </div>
              </details>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Module 8 — Daily Sync (docs/08 §M8). Today's morning briefing over `daily_syncs`. */
export default async function DailySyncPage(): Promise<React.JSX.Element> {
  const todayDate = easternDateString(new Date());
  const [today, user, showHealth] = await Promise.all([
    getDailySync(todayDate),
    getCurrentUser(),
    getHealthScoresVisible().catch(() => true), // a read blip must never break the page
  ]);

  return (
    <PageContainer className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Daily Sync</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {longEtDate(todayDate)} · generated ~6:00 AM Eastern
          </p>
        </div>
        {user.role === 'admin' ? <GenerateSyncButton /> : null}
      </header>
      <DailySyncView record={today} dateLabel={longEtDate(todayDate)} showHealth={showHealth} />
    </PageContainer>
  );
}
