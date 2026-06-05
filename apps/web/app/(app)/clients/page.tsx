import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Module 2 — Client List (docs/08 §8 M2). */
export default function ClientsPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Clients"
      description="Active client relationships at a glance."
      emptyTitle="No clients yet"
      emptyDescription="A grid of client cards — avatar, contract, cadence, and health score — will appear here once clients are added."
    />
  );
}
