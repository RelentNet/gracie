'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import type { Office, OfficeWithHolder } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextAreaField, TextField } from '@/components/ui/Field';

/**
 * Create / edit an office (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * `office === null` → create mode (`POST /api/clients/:id/offices`, optionally under
 * `defaultParentId`); `office` set → edit mode (`PATCH .../offices/:officeId`). The
 * reports-to picker lists every other office in the org (self excluded when editing);
 * "— None (top level) —" makes it a root — sent as `null` on create and as `''` on
 * patch, per the API contract. On success it calls `onSaved()` (the tab re-fetches)
 * and closes.
 */
const NONE_VALUE = '';

interface OfficeFormModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly clientId: string;
  /** Flat office list for the reports-to picker (holder-enriched; holder unused here). */
  readonly offices: readonly OfficeWithHolder[];
  /** Set → edit that office; null/undefined → create. */
  readonly office?: Office | null;
  /** Pre-selects the reports-to parent when creating a child office. */
  readonly defaultParentId?: string | null;
  readonly onSaved: () => void;
}

export function OfficeFormModal({
  isOpen,
  onClose,
  clientId,
  offices,
  office = null,
  defaultParentId = null,
  onSaved,
}: OfficeFormModalProps): React.JSX.Element {
  const editing = office !== null;

  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState<string>(NONE_VALUE);
  const [description, setDescription] = useState('');
  const [isKey, setIsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form each time the modal opens (or the target office changes).
  useEffect(() => {
    if (!isOpen) return;
    if (office !== null) {
      setTitle(office.title);
      setParentId(office.parentOfficeId ?? NONE_VALUE);
      setDescription(office.description ?? '');
      setIsKey(office.isKey);
    } else {
      setTitle('');
      setParentId(defaultParentId ?? NONE_VALUE);
      setDescription('');
      setIsKey(false);
    }
    setError(null);
  }, [isOpen, office, defaultParentId]);

  const parentOptions = [
    { value: NONE_VALUE, label: '— None (top level) —' },
    ...offices
      .filter((o) => o.id !== office?.id)
      .map((o) => ({ value: o.id, label: o.title })),
  ];

  async function submit(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '' || saving) return;
    setSaving(true);
    setError(null);
    const desc = description.trim();
    try {
      if (office !== null) {
        await apiClient.patch<{ office: Office }>(`/api/clients/${clientId}/offices/${office.id}`, {
          title: trimmed,
          // '' makes it a root (API contract for PATCH).
          parentOfficeId: parentId,
          description: desc,
          isKey,
        });
      } else {
        await apiClient.post<{ office: Office }>(`/api/clients/${clientId}/offices`, {
          title: trimmed,
          // null makes it a root (API contract for POST).
          parentOfficeId: parentId === NONE_VALUE ? null : parentId,
          description: desc === '' ? null : desc,
          isKey,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save office');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit office' : 'Add office'}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving || title.trim() === ''}
            onClick={(): void => void submit()}
          >
            {saving ? 'Saving…' : editing ? 'Save' : 'Add office'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="e.g. Chief Information Officer"
          required
        />

        <SelectField
          label="Reports to"
          value={parentId}
          onChange={setParentId}
          options={parentOptions}
        />

        <TextAreaField
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="What this office is responsible for (optional)."
        />

        <label className="flex items-center gap-2" htmlFor="office-is-key">
          <input
            id="office-is-key"
            type="checkbox"
            checked={isKey}
            onChange={(event): void => setIsKey(event.target.checked)}
          />
          <span className="inline-flex items-center gap-1.5" style={TYPE.body}>
            <Star size={14} aria-hidden="true" style={{ color: 'var(--color-amber-600)' }} />
            Key office — flag prominently when it goes vacant
          </span>
        </label>

        <FormError message={error} />
      </div>
    </Modal>
  );
}
