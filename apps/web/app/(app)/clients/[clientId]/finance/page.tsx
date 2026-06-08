'use client';

import { use } from 'react';
import { Lock } from 'lucide-react';
import type { Task } from '@gracie/shared';

import { getClientById, getTasksByClient } from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { feeTierDisplay, formatUsd } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';

/**
 * Client tab 3 — Finance (docs/08 §9). ADMIN-ONLY. The tab is hidden from the
 * tab nav for non-admins (client layout); this guard is defense-in-depth so a
 * direct URL visit still yields no finance content (mirrors server omission,
 * D14). Admin-only fields are marked with a 🔒 (docs/08 §1).
 */
export default function ClientFinancePage({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): React.JSX.Element {
  const { clientId } = use(params);
  const { can } = useAuth();

  if (!can('finance.view')) {
    return (
      <ErrorState
        title="Access restricted"
        description="Financial details for this client are available to administrators only."
      />
    );
  }

  const client = getClientById(clientId);
  if (client === undefined) {
    return <ErrorState title="Client not found" description="This client reference is invalid." />;
  }

  const tasks: readonly Task[] = getTasksByClient(clientId).filter((task) => !task.isArchived);
  const completedCount = tasks.filter((task) => task.status === 'complete').length;
  const completionRate = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);
  const fee = feeTierDisplay(client.feeTier);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card>
          <p style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Fee Tier</p>
          {fee !== null ? (
            <p className="mt-2 flex items-center gap-2" style={{ ...TYPE.sectionHeader, color: fee.color }}>
              <span aria-hidden="true">{fee.dot}</span>
              {fee.label}
            </p>
          ) : (
            <p className="mt-2" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              Not set
            </p>
          )}
        </Card>

        <Card accent="admin">
          <p className="flex items-center gap-1.5" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            <Lock aria-hidden="true" size={12} />
            Contract Value
          </p>
          <p className="mt-2" style={TYPE.sectionHeader}>
            {formatUsd(client.contractValue)}
          </p>
        </Card>

        <Card accent="admin">
          <p className="flex items-center gap-1.5" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            <Lock aria-hidden="true" size={12} />
            Billing Cadence
          </p>
          <p className="mt-2" style={TYPE.sectionHeader}>
            {client.billingCadence ?? 'Not set'}
          </p>
        </Card>
      </div>

      {/* Task completion rate */}
      <Card>
        <CardHeader
          title="Task Completion Rate"
          description="Completed vs. total active tasks for this client."
        />
        {tasks.length === 0 ? (
          <EmptyState
            title="No tasks to measure"
            description="Completion rate will appear once tasks exist for this client."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span style={{ ...TYPE.sectionHeader, color: 'var(--color-emerald-600)' }}>
                {completionRate}%
              </span>
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                {completedCount} of {tasks.length} tasks complete
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={completionRate}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Task completion rate"
              style={{ backgroundColor: 'var(--color-slate-100)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${completionRate}%`, backgroundColor: 'var(--color-emerald-500)' }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Time vs revenue */}
      <Card>
        <CardHeader
          title="Time vs. Revenue"
          description="Effort-to-revenue comparison for this engagement."
        />
        <EmptyState
          title="Time tracking not connected"
          description="Logged hours are not yet captured in Phase 2. This panel will compare tracked time against contract revenue once time entries are available."
        />
      </Card>
    </div>
  );
}
