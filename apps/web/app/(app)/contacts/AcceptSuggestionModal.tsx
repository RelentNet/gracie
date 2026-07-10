'use client';

import { useEffect, useState } from 'react';
import { Mail, UserPlus } from 'lucide-react';
import type { Client, ContactSuggestionView, Office } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextField } from '@/components/ui/Field';
import { ClientAvatar } from '@/components/ClientAvatar';

import { contactInitials } from './shared';

/**
 * Accept-a-suggestion dialog (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * Turns a pending {@link ContactSuggestionView} into a real contact. The editor picks
 * the org affiliation (defaulting to the domain-guessed org, or "— No organization —"
 * to add the person org-agnostically), and — once an org is chosen — an optional formal
 * office (fetched on demand) or a freeform title. On success the parent drops the row
 * from the inbox.
 */
interface AcceptSuggestionModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly suggestion: ContactSuggestionView;
  readonly orgs: readonly Client[];
  readonly onAccepted: () => void;
}

const NO_ORG = '';
const NO_OFFICE = '';

interface OfficesResponse {
  readonly offices: readonly Office[];
}

interface AcceptResponse {
  readonly contact: unknown;
}

export function AcceptSuggestionModal({
  isOpen,
  onClose,
  suggestion,
  orgs,
  onAccepted,
}: AcceptSuggestionModalProps): React.JSX.Element {
  // Default the org to the domain-guessed one, but only if it's a real option here.
  const [orgId, setOrgId] = useState<string>(() =>
    suggestion.clientId !== null && orgs.some((o) => o.id === suggestion.clientId)
      ? suggestion.clientId
      : NO_ORG,
  );
  const [officeId, setOfficeId] = useState<string>(NO_OFFICE);
  const [title, setTitle] = useState<string>('');
  const [offices, setOffices] = useState<readonly Office[] | null>(null);
  const [officesError, setOfficesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const displayName =
    suggestion.suggestedName ?? suggestion.suggestedEmail ?? 'Unknown person';

  // Fetch the org's offices on demand so we can offer the optional office picker.
  useEffect(() => {
    if (orgId === NO_ORG) {
      setOffices(null);
      setOfficesError(null);
      return;
    }
    let active = true;
    setOffices(null);
    setOfficesError(null);
    apiClient
      .get<OfficesResponse>(`/api/clients/${orgId}/offices`)
      .then((d) => {
        if (active) setOffices(d.offices);
      })
      .catch((e: unknown) => {
        if (active) setOfficesError(e instanceof Error ? e.message : 'Failed to load offices');
      });
    return (): void => {
      active = false;
    };
  }, [orgId]);

  function changeOrg(value: string): void {
    setOrgId(value);
    setOfficeId(NO_OFFICE); // The old office belongs to the old org.
  }

  function submit(): void {
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> =
      orgId === NO_ORG
        ? { clientId: null }
        : {
            clientId: orgId,
            ...(officeId !== NO_OFFICE ? { officeId } : {}),
            ...(title.trim() !== '' ? { title: title.trim() } : {}),
          };
    apiClient
      .post<AcceptResponse>(`/api/contact-suggestions/${suggestion.id}/accept`, body)
      .then(() => {
        onAccepted();
        onClose();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to accept suggestion'))
      .finally(() => setSubmitting(false));
  }

  const orgOptions: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
    { value: NO_ORG, label: '— No organization —' },
    ...orgs.map((o) => ({ value: o.id, label: o.name })),
  ];

  const officeOptions: ReadonlyArray<{ readonly value: string; readonly label: string }> =
    offices === null
      ? []
      : [
          { value: NO_OFFICE, label: '— No office —' },
          ...offices.map((o) => ({ value: o.id, label: o.title })),
        ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Accept suggestion"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<UserPlus size={16} aria-hidden="true" />}
            onClick={submit}
            disabled={submitting}
            style={{
              backgroundColor: 'var(--color-emerald-500)',
              borderColor: 'var(--color-emerald-500)',
            }}
          >
            {submitting ? 'Accepting…' : 'Accept'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <ClientAvatar initials={contactInitials(displayName)} size="md" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>{displayName}</span>
            {suggestion.suggestedEmail !== null ? (
              <span
                className="inline-flex items-center gap-1.5 font-data"
                style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
              >
                <Mail size={14} aria-hidden="true" />
                {suggestion.suggestedEmail}
              </span>
            ) : null}
          </div>
        </div>

        <SelectField
          label="Organization"
          value={orgId}
          onChange={changeOrg}
          options={orgOptions}
          disabled={submitting}
        />

        {orgId !== NO_ORG ? (
          officesError !== null ? (
            <FormError message={officesError} />
          ) : offices === null ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Loading offices…</p>
          ) : offices.length > 0 ? (
            <SelectField
              label="Office (optional)"
              value={officeId}
              onChange={setOfficeId}
              options={officeOptions}
              disabled={submitting}
            />
          ) : null
        ) : null}

        {officeId === NO_OFFICE ? (
          <TextField
            label="Role / title (optional)"
            value={title}
            onChange={setTitle}
            placeholder="e.g. Program Manager"
            disabled={submitting}
          />
        ) : null}

        <FormError message={error} />
      </div>
    </Modal>
  );
}
