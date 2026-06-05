import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Client tab 5 — Notes (docs/08 §9). */
export default function ClientNotesPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Notes"
      description="Shared client notes, newest first."
      emptyTitle="No notes yet"
      emptyDescription="A compose area and a chronological feed of notes — each with author and timestamp — will appear here. Editors can add notes; authors can edit their own."
    />
  );
}
