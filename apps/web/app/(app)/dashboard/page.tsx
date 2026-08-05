import { PageContainer } from '@/components/ui/PageContainer';

import { CommandCenter } from './CommandCenter';

/** Module 1 — Daily Command Center (docs/08 §8 M1). Standalone Overview page. */
export default function DashboardPage(): React.JSX.Element {
  return (
    <PageContainer>
      <CommandCenter variant="grid" />
    </PageContainer>
  );
}
