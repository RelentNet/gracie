import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 7 — Calendar (docs/08 §8 M7). */
export default function CalendarPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Calendar"
      description="Team meeting calendar and connection status."
      emptyTitle="No meetings scheduled"
      emptyDescription="A month grid with day detail, calendar connection status, and cadence trackers will appear here once Microsoft Graph is connected."
    />
  );
}
