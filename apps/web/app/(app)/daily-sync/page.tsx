import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 8 — Daily Sync (docs/08 §8 M8). */
export default function DailySyncPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Daily Sync"
      description="Today's briefing, generated at 6:00 AM Eastern."
      emptyTitle="No sync generated yet"
      emptyDescription="The morning briefing — today's meetings, priorities, and follow-ups — will appear here once the daily-sync job runs."
    />
  );
}
