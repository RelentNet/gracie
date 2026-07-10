'use client';

import { useEffect, useState } from 'react';
import type { Client, Contact } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextAreaField, TextField } from '@/components/ui/Field';

/**
 * Create-a-contact modal (phase `CO`). Captures the person's details and an OPTIONAL
 * initial org affiliation (+ freeform role) so a new contact can be attached in one
 * step. Office assignment happens on the org chart. Editor-only (the caller renders it
 * only for editors). POSTs `/api/contacts` and lifts the created contact to the parent.
 */
interface NewContactModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly orgs: readonly Client[];
  readonly onCreated: (contact: Contact) => void;
}

interface FormState {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly linkedinUrl: string;
  readonly notes: string;
  readonly clientId: string;
  readonly title: string;
}

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  notes: '',
  clientId: '',
  title: '',
};

export function NewContactModal({
  isOpen,
  onClose,
  orgs,
  onCreated,
}: NewContactModalProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY);
      setError(null);
    }
  }, [isOpen]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function close(): void {
    setForm(EMPTY);
    setError(null);
    onClose();
  }

  async function submit(): Promise<void> {
    if (form.fullName.trim() === '') {
      setError('A contact name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        linkedinUrl: form.linkedinUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
        clientId: form.clientId !== '' ? form.clientId : undefined,
        title: form.clientId !== '' && form.title.trim() !== '' ? form.title.trim() : undefined,
      };
      const { contact } = await apiClient.post<{ contact: Contact }>('/api/contacts', payload);
      onCreated(contact);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create contact.');
    } finally {
      setSaving(false);
    }
  }

  const orgOptions = [
    { value: '', label: '— No organization —' },
    ...orgs.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="New contact"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Adding…' : 'Add contact'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Full name *"
          value={form.fullName}
          onChange={(v) => set('fullName', v)}
          placeholder="e.g. Dana Reyes"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Email" type="email" value={form.email} onChange={(v) => set('email', v)} />
          <TextField label="Phone" value={form.phone} onChange={(v) => set('phone', v)} />
        </div>
        <TextField
          label="LinkedIn URL"
          type="url"
          value={form.linkedinUrl}
          onChange={(v) => set('linkedinUrl', v)}
          placeholder="https://linkedin.com/in/…"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Organization (optional)"
            value={form.clientId}
            onChange={(v) => set('clientId', v)}
            options={orgOptions}
          />
          <TextField
            label="Role / title"
            value={form.title}
            onChange={(v) => set('title', v)}
            disabled={form.clientId === ''}
            placeholder={form.clientId === '' ? 'Pick an org first' : 'e.g. CIO'}
          />
        </div>
        <TextAreaField label="Notes" value={form.notes} onChange={(v) => set('notes', v)} />
        <FormError message={error} />
      </div>
    </Modal>
  );
}
