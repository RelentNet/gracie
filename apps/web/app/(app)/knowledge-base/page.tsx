import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 9 — Knowledge Base (docs/08 §8 M9). */
export default function KnowledgeBasePage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Knowledge Base"
      description="Reference documents available to the AI assistant."
      emptyTitle="No knowledge-base documents"
      emptyDescription="Uploaded reference material with topic tags, type, and expiry badges will appear here once knowledge-base uploads are enabled."
    />
  );
}
