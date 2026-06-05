import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Client tab 1 — Overview (docs/08 §9). */
export default function ClientOverviewPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Overview"
      description="Health score, last meeting snapshot, and top open tasks."
      emptyTitle="No overview data yet"
      emptyDescription="Relationship health, the latest meeting summary, top-3 open tasks, and an editable description will appear here once the client data layer is connected."
    />
  );
}
