import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Client tab 4 — Operations (docs/08 §9). */
export default function ClientOperationsPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Operations"
      description="Client-scoped tasks, pipeline runs, and transcript history."
      emptyTitle="No operations data yet"
      emptyDescription="A client-scoped task table, pipeline run history, and transcript history with source badges will appear here once the data layer is connected."
    />
  );
}
