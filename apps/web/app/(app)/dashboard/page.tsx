import Link from 'next/link';
import { Sunrise } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/PageContainer';
import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { easternDateString, getDailySync } from '@/lib/data/daily-sync';
import { todayEastern } from '@/lib/format';
import { TYPE } from '@/lib/typography';

/** Compact Daily Sync banner for the dashboard (M1 → links into Module 8). */
async function DailySyncBanner(): Promise<React.JSX.Element> {
  // Resilient: a daily_syncs read blip must never break the landing page — fall
  // back to the neutral "not generated yet" banner.
  const today = await getDailySync(easternDateString(new Date())).catch(() => null);
  const content = today?.content ?? null;

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

/** Module 1 — Daily Command Center (docs/08 §8 M1). */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  return (
    <PageContainer className="flex flex-col gap-6">
      <DailySyncBanner />
      <PagePlaceholder
        title="Daily Command Center"
        description={todayEastern()}
        emptyTitle="No activity yet"
        emptyDescription="Today's meeting pipeline, priority tasks, and needs-attention alerts will appear here once the data layer is connected."
      />
    </PageContainer>
  );
}
