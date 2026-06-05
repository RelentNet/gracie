'use client';

import { PagePlaceholder } from '@/components/ui/PagePlaceholder';
import { ErrorState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';
import { useAuth } from '@/lib/auth';

/**
 * Client tab 3 — Finance (docs/08 §9). ADMIN-ONLY. The tab is hidden from the
 * tab nav for non-admins; this guard is defense-in-depth so a direct URL visit
 * still yields no finance content (mirrors server omission, D14). Finance data
 * (fee tier, contract value, billing cadence) is admin-only at the API/RLS layer.
 */
export default function ClientFinancePage(): React.JSX.Element {
  const { can } = useAuth();

  if (!can('finance.view')) {
    return (
      <section className="flex flex-col gap-4">
        <h2 style={TYPE.sectionHeader}>Finance</h2>
        <ErrorState
          title="Access restricted"
          description="Financial details for this client are available to administrators only."
        />
      </section>
    );
  }

  return (
    <PagePlaceholder
      title="Finance"
      description="Fee tier, contract value, billing cadence, and completion rate."
      emptyTitle="No finance data yet"
      emptyDescription="Fee tier, contract value, billing cadence, task completion rate, and time-vs-revenue will appear here once finance data is connected."
    />
  );
}
