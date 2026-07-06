'use client';

import { useEffect, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { CLIENT_CADENCES, FEE_TIERS } from '@gracie/shared';
import type { Client, ClientCadence, ClientType, FeeTier } from '@gracie/shared';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cadenceLabel } from '@/lib/client-display';
import { TYPE } from '@/lib/typography';

/** Party types a user can create here (the reserved `internal` org is excluded). */
const PARTY_TYPE_OPTIONS: ReadonlyArray<{ readonly value: ClientType; readonly label: string }> = [
  { value: 'client', label: 'Client' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'lead', label: 'Lead' },
  { value: 'partner', label: 'Partner' },
];

interface AddClientModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (client: Client) => void;
  /** Pre-selects the party type from the active roster tab (P4.1). */
  readonly defaultType?: ClientType;
}

interface FormState {
  readonly name: string;
  readonly type: ClientType;
  readonly initials: string;
  readonly cadence: ClientCadence;
  readonly domains: string;
  readonly primaryContact: string;
  readonly primaryContactEmail: string;
  readonly contractNumber: string;
  readonly feeTier: '' | FeeTier;
  readonly contractValue: string;
  readonly description: string;
}

const EMPTY: FormState = {
  name: '',
  type: 'client',
  initials: '',
  cadence: 'monthly',
  domains: '',
  primaryContact: '',
  primaryContactEmail: '',
  contractNumber: '',
  feeTier: '',
  contractValue: '',
  description: '',
};

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

export function AddClientModal({
  isOpen,
  onClose,
  onCreated,
  defaultType = 'client',
}: AddClientModalProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>({ ...EMPTY, type: defaultType });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select the party type from the active roster tab each time the modal opens.
  useEffect(() => {
    if (isOpen) setForm((prev) => ({ ...prev, type: defaultType }));
  }, [isOpen, defaultType]);

  function close(): void {
    setForm({ ...EMPTY, type: defaultType });
    setError(null);
    onClose();
  }

  async function submit(): Promise<void> {
    const name = form.name.trim();
    if (name === '') {
      setError('Client name is required.');
      return;
    }
    const contractValueRaw = form.contractValue.trim();
    if (contractValueRaw !== '' && Number.isNaN(Number(contractValueRaw))) {
      setError('Contract value must be a number.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const domains = form.domains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter((d) => d !== '');
      const payload = {
        name,
        type: form.type,
        initials: form.initials.trim() || undefined,
        cadence: form.cadence,
        domains: domains.length > 0 ? domains : undefined,
        primaryContact: form.primaryContact.trim() || undefined,
        primaryContactEmail: form.primaryContactEmail.trim() || undefined,
        contractNumber: form.contractNumber.trim() || undefined,
        description: form.description.trim() || undefined,
        feeTier: form.feeTier === '' ? undefined : form.feeTier,
        contractValue: contractValueRaw === '' ? undefined : Number(contractValueRaw),
      };
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { client?: Client; error?: { message?: string } }
        | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }
      if (body?.client !== undefined) {
        onCreated(body.client);
      }
      setForm({ ...EMPTY, type: defaultType });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create client.');
    } finally {
      setSubmitting(false);
    }
  }

  type TextKey =
    | 'name'
    | 'initials'
    | 'domains'
    | 'primaryContact'
    | 'primaryContactEmail'
    | 'contractNumber'
    | 'contractValue'
    | 'description';
  const text =
    (key: TextKey) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
    };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Add client"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void submit();
            }}
            disabled={submitting}
          >
            {submitting ? 'Adding…' : 'Add client'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Client name *">
          <input
            className={inputClass}
            style={inputStyle}
            value={form.name}
            onChange={text('name')}
            placeholder="e.g. CMS Data Analytics"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select
              className={inputClass}
              style={inputStyle}
              value={form.type}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, type: e.target.value as ClientType }));
              }}
            >
              {PARTY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Initials">
            <input
              className={inputClass}
              style={inputStyle}
              value={form.initials}
              onChange={text('initials')}
              placeholder="Auto from name"
              maxLength={4}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cadence">
            <select
              className={inputClass}
              style={inputStyle}
              value={form.cadence}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, cadence: e.target.value as ClientCadence }));
              }}
            >
              {CLIENT_CADENCES.map((value) => (
                <option key={value} value={value}>
                  {cadenceLabel(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Org domains">
            <input
              className={inputClass}
              style={inputStyle}
              value={form.domains}
              onChange={text('domains')}
              placeholder="acme.com, sub.acme.com"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary contact">
            <input className={inputClass} style={inputStyle} value={form.primaryContact} onChange={text('primaryContact')} />
          </Field>
          <Field label="Primary contact email">
            <input
              type="email"
              className={inputClass}
              style={inputStyle}
              value={form.primaryContactEmail}
              onChange={text('primaryContactEmail')}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Contract number">
            <input className={inputClass} style={inputStyle} value={form.contractNumber} onChange={text('contractNumber')} />
          </Field>
          <Field label="Contract value (USD)">
            <input
              inputMode="decimal"
              className={inputClass}
              style={inputStyle}
              value={form.contractValue}
              onChange={text('contractValue')}
              placeholder="Admin only"
            />
          </Field>
        </div>

        <Field label="Fee tier">
          <select
            className={inputClass}
            style={inputStyle}
            value={form.feeTier}
            onChange={(e) => {
              setForm((prev) => ({ ...prev, feeTier: e.target.value as '' | FeeTier }));
            }}
          >
            <option value="">None</option>
            {FEE_TIERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description (used in AI prompts)">
          <textarea
            className={inputClass}
            style={inputStyle}
            rows={3}
            value={form.description}
            onChange={text('description')}
          />
        </Field>

        {error !== null ? (
          <span style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>{error}</span>
        ) : null}
      </div>
    </Modal>
  );
}
