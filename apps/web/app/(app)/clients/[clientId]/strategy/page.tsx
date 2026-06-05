import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/** Client tab 2 — Strategy (docs/08 §9). Includes the MASTER_RECORD chronology. */
export default function ClientStrategyPage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Strategy"
      description="Trajectory, meeting-frequency trend, and risk flags."
      emptyTitle="No strategy data yet"
      emptyDescription="The relationship trajectory, frequency trend, risk flags, and the master-record chronology will appear here once meeting history is available."
    />
  );
}
