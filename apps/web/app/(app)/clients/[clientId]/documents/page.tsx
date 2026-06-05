import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/**
 * Client tab 6 — Documents (docs/08 §9). Two-panel file browser; the
 * Transcripts folder is Admin-only (restricted visibility, D14).
 */
export default function ClientDocumentsPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Documents"
      description="Client file browser. The Transcripts folder is Admin-only."
      emptyTitle="No documents yet"
      emptyDescription="A two-panel folder tree and file list will appear here once file storage is connected. Restricted folders are hidden for unauthorized roles."
    />
  );
}
