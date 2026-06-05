import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 4 — Pipeline Monitor (docs/08 §8 M4). */
export default function PipelinePage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Pipeline"
      description="Live status of meeting document generation."
      emptyTitle="No pipeline activity"
      emptyDescription="Meetings with live processing status badges will appear here. Manual trigger and error logs are Admin-only and wire up in a later phase."
    />
  );
}
