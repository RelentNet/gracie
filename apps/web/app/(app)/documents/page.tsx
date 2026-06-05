import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 5 — Global document browser (docs/08 §8 M5). */
export default function DocumentsPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Documents"
      description="Two-panel file browser across all clients."
      emptyTitle="No documents yet"
      emptyDescription="Generated and uploaded files will appear in a folder tree with inline preview once file storage is connected."
    />
  );
}
