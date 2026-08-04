'use client';

import { useCallback, useState } from 'react';
import type { ClientType, ExternalAttendee } from '@gracie/shared';
import { deriveOrgNameFromDomain } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

import { CREATE_ORG_TYPES } from '../lib/calendar-meeting';

/** Modal: create a client/lead/prospect/partner from an unknown meeting domain. */
export function CreateOrgModal({
  meetingId,
  domain,
  defaultType,
  suggested,
  onClose,
  onCreated,
}: {
  readonly meetingId: string;
  readonly domain: string;
  readonly defaultType: ClientType;
  readonly suggested: ExternalAttendee | null;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}): React.JSX.Element {
  const [name, setName] = useState<string>(deriveOrgNameFromDomain(domain));
  const [type, setType] = useState<ClientType>(defaultType);
  const [contact, setContact] = useState<string>(suggested?.name ?? '');
  const [contactEmail, setContactEmail] = useState<string>(suggested?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback((): void => {
    if (name.trim() === '') {
      setError('A name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    apiClient
      .post(`/api/calendar/meetings/${meetingId}/create-org`, {
        domain,
        name: name.trim(),
        type,
        primaryContact: contact.trim() || undefined,
        primaryContactEmail: contactEmail.trim() || undefined,
      })
      .then(() => onCreated())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to create org'))
      .finally(() => setSubmitting(false));
  }, [meetingId, domain, name, type, contact, contactEmail, onCreated]);

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create organization"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          New org for <span className="font-data">{domain}</span>. Past and future meetings on this
          domain will link automatically.
        </p>
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Name *</span>
          <input
            className={inputClass}
            style={inputStyle}
            value={name}
            onChange={(e): void => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Type</span>
          <select
            className={inputClass}
            style={inputStyle}
            value={type}
            onChange={(e): void => setType(e.target.value as ClientType)}
          >
            {CREATE_ORG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Primary contact</span>
            <input
              className={inputClass}
              style={inputStyle}
              value={contact}
              onChange={(e): void => setContact(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Contact email</span>
            <input
              type="email"
              className={inputClass}
              style={inputStyle}
              value={contactEmail}
              onChange={(e): void => setContactEmail(e.target.value)}
            />
          </label>
        </div>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
