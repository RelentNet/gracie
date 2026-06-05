import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 6 — Task Board (docs/08 §8 M6). */
export default function TasksPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Task Board"
      description="Cross-client tasks with overdue and 48-hour flags."
      emptyTitle="No tasks yet"
      emptyDescription="Extracted and manually-added tasks will appear here. Viewers can mark their own tasks complete; editors manage all tasks."
    />
  );
}
