import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { todayEastern } from '@/lib/format';

/** Module 1 — Daily Command Center (docs/08 §8 M1). */
export default function DashboardPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Daily Command Center"
      description={todayEastern()}
      emptyTitle="No activity yet"
      emptyDescription="Today's meeting pipeline, priority tasks, and needs-attention alerts will appear here once the data layer is connected."
    />
  );
}
