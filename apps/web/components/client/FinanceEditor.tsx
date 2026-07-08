'use client';

import { useState } from 'react';
import { Lock, Pencil } from 'lucide-react';
import { FEE_TIERS } from '@gracie/shared';
import type { Client, FeeTier } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { feeTierDisplay, formatUsd } from '@/lib/client-display';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError, SelectField, TextField } from '@/components/ui/Field';

/**
 * Finance → Financials editor (P2.1). ADMIN-ONLY on read AND write — `fee_tier`,
 * `contract_value`, `billing_cadence` flow through `PATCH /api/clients/:id`, which
 * rejects these fields for non-admins (mirrors `redactClientForRole`). Read mode shows
 * the three fee cards; Edit swaps to an inline form. On save the parent's client
 * state is updated from the API response.
 */
const FEE_TIER_OPTIONS = [
  { value: '', label: 'Not set' },
  ...FEE_TIERS.map((tier) => ({ value: tier, label: feeTierDisplay(tier)?.label ?? tier })),
];

export function FinanceEditor({
  client,
  onChange,
}: {
  readonly client: Client;
  readonly onChange: (client: Client) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [feeTier, setFeeTier] = useState<string>(client.feeTier ?? '');
  const [contractValue, setContractValue] = useState<string>(
    client.contractValue !== null ? String(client.contractValue) : '',
  );
  const [billingCadence, setBillingCadence] = useState<string>(client.billingCadence ?? '');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(): void {
    setFeeTier(client.feeTier ?? '');
    setContractValue(client.contractValue !== null ? String(client.contractValue) : '');
    setBillingCadence(client.billingCadence ?? '');
    setError(null);
    setEditing(true);
  }

  async function save(): Promise<void> {
    if (saving) return;
    let contractValueNum: number | null = null;
    if (contractValue.trim() !== '') {
      const parsed = Number(contractValue);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Contract value must be a non-negative number.');
        return;
      }
      contractValueNum = parsed;
    }
    setSaving(true);
    setError(null);
    try {
      const { client: updated } = await apiClient.patch<{ client: Client }>(`/api/clients/${client.id}`, {
        feeTier: feeTier === '' ? null : (feeTier as FeeTier),
        contractValue: contractValueNum,
        billingCadence,
      });
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Card accent="admin">
        <CardHeader title="Financials" description="Admin-only contract terms." />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectField label="Fee tier" value={feeTier} onChange={setFeeTier} options={FEE_TIER_OPTIONS} />
            <TextField label="Contract value (USD)" type="number" min={0} value={contractValue} onChange={setContractValue} placeholder="0" />
            <TextField label="Billing cadence" value={billingCadence} onChange={setBillingCadence} placeholder="e.g. Monthly" />
          </div>
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={(): void => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={(): void => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const fee = feeTierDisplay(client.feeTier);

  return (
    <Card accent="admin">
      <CardHeader
        title="Financials"
        description="Admin-only contract terms."
        action={
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
            style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', cursor: 'pointer', background: 'transparent' }}
          >
            <Pencil aria-hidden="true" size={14} />
            Edit
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
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
        </div>
        <div>
          <p className="flex items-center gap-1.5" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            <Lock aria-hidden="true" size={12} />
            Contract Value
          </p>
          <p className="mt-2" style={TYPE.sectionHeader}>
            {formatUsd(client.contractValue)}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1.5" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            <Lock aria-hidden="true" size={12} />
            Billing Cadence
          </p>
          <p className="mt-2" style={TYPE.sectionHeader}>
            {client.billingCadence ?? 'Not set'}
          </p>
        </div>
      </div>
    </Card>
  );
}
