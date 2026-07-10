'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Linkedin, Mail, Phone, Plus, Trash2, UserMinus } from 'lucide-react';
import type { AffiliationView, Client, ContactWithAffiliations } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ClientAvatar } from '@/components/ClientAvatar';

import { OrgTypeBadge, contactInitials, tenureLabel } from './shared';

/**
 * Contact profile drawer (phase `CO`). Shows a contact's details + full affiliation
 * history (current and past, each with org/office/tenure), and — for editors — inline
 * detail editing, add/end affiliation, delete, and CSV/vCard download. Moving a person
 * to a new org is "End" the current affiliation + "Add" a new one, which preserves
 * history (both show). Read-only for viewers.
 */
interface ContactProfileDrawerProps {
  readonly contactId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly orgs: readonly Client[];
  readonly canEdit: boolean;
  /** Called after any mutation so the parent list can refresh. */
  readonly onChanged: () => void;
}

/** A styled anchor download (an attachment route needs a real `<a download>`). */
function DownloadLink({ href, label }: { readonly href: string; readonly label: string }): React.JSX.Element {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', ...TYPE.bodyStrong }}
    >
      <Download size={16} aria-hidden="true" />
      {label}
    </a>
  );
}

export function ContactProfileDrawer({
  contactId,
  isOpen,
  onClose,
  orgs,
  canEdit,
  onChanged,
}: ContactProfileDrawerProps): React.JSX.Element {
  const [data, setData] = useState<ContactWithAffiliations | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ fullName: '', email: '', phone: '', linkedinUrl: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({ clientId: '', title: '', startedOn: '' });

  const reload = useCallback((): void => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setData(null);
    setLoadError(null);
    setEditing(false);
    setShowAdd(false);
    setActionError(null);
    apiClient
      .get<{ contact: ContactWithAffiliations }>(`/api/contacts/${contactId}`)
      .then((d) => {
        if (active) setData(d.contact);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load contact');
      });
    return (): void => {
      active = false;
    };
  }, [isOpen, contactId, reloadKey]);

  function startEdit(): void {
    if (data === null) return;
    setDraft({
      fullName: data.fullName,
      email: data.email ?? '',
      phone: data.phone ?? '',
      linkedinUrl: data.linkedinUrl ?? '',
      notes: data.notes ?? '',
    });
    setFormError(null);
    setEditing(true);
  }

  async function saveDetails(): Promise<void> {
    if (draft.fullName.trim() === '') {
      setFormError('A contact name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiClient.patch<{ contact: ContactWithAffiliations }>(`/api/contacts/${contactId}`, {
        fullName: draft.fullName.trim(),
        email: draft.email,
        phone: draft.phone,
        linkedinUrl: draft.linkedinUrl,
        notes: draft.notes,
      });
      setEditing(false);
      reload();
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function endAffiliation(id: string): Promise<void> {
    setBusy(`end:${id}`);
    setActionError(null);
    try {
      await apiClient.patch(`/api/contacts/${contactId}/affiliations/${id}`, { end: true });
      reload();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to end affiliation.');
    } finally {
      setBusy(null);
    }
  }

  async function addAffiliation(): Promise<void> {
    if (addDraft.clientId === '') {
      setActionError('Pick an organization.');
      return;
    }
    setBusy('add');
    setActionError(null);
    try {
      await apiClient.post(`/api/contacts/${contactId}/affiliations`, {
        clientId: addDraft.clientId,
        title: addDraft.title.trim() || undefined,
        startedOn: addDraft.startedOn || undefined,
      });
      setShowAdd(false);
      setAddDraft({ clientId: '', title: '', startedOn: '' });
      reload();
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to add affiliation.');
    } finally {
      setBusy(null);
    }
  }

  async function deleteContact(): Promise<void> {
    if (data === null) return;
    if (!window.confirm(`Delete ${data.fullName}? This removes them from every office they hold.`)) {
      return;
    }
    setBusy('delete');
    setActionError(null);
    try {
      await apiClient.del(`/api/contacts/${contactId}`);
      onChanged();
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete contact.');
      setBusy(null);
    }
  }

  const title = data?.fullName ?? 'Contact';
  const current = (data?.affiliations ?? []).filter((a) => a.isCurrent);
  const past = (data?.affiliations ?? []).filter((a) => !a.isCurrent);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {canEdit && data !== null ? (
              <Button
                variant="danger"
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={() => void deleteContact()}
                disabled={busy === 'delete'}
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete'}
              </Button>
            ) : null}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto">
        {loadError !== null ? (
          <ErrorState
            title="Couldn’t load contact"
            description={loadError}
            action={
              <Button variant="secondary" onClick={reload}>
                Retry
              </Button>
            }
          />
        ) : data === null ? (
          <LoadingState label="Loading contact…" />
        ) : (
          <>
            <div className="flex items-start gap-3">
              <ClientAvatar initials={contactInitials(data.fullName)} size="lg" />
              <div className="flex min-w-0 flex-col gap-1">
                <span style={TYPE.sectionHeader}>{data.fullName}</span>
                <div className="flex flex-wrap items-center gap-3" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {data.email !== null ? (
                    <a href={`mailto:${data.email}`} className="inline-flex items-center gap-1.5 font-data" style={{ color: 'var(--color-blue-700)' }}>
                      <Mail size={14} aria-hidden="true" />
                      {data.email}
                    </a>
                  ) : null}
                  {data.phone !== null ? (
                    <span className="inline-flex items-center gap-1.5 font-data">
                      <Phone size={14} aria-hidden="true" />
                      {data.phone}
                    </span>
                  ) : null}
                  {data.linkedinUrl !== null ? (
                    <a href={data.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-blue-700)' }}>
                      <Linkedin size={14} aria-hidden="true" />
                      LinkedIn
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DownloadLink href={`/api/contacts/${contactId}/export?format=csv`} label="Download CSV" />
              <DownloadLink href={`/api/contacts/${contactId}/export?format=vcard`} label="Download vCard" />
              {canEdit && !editing ? (
                <Button variant="ghost" onClick={startEdit}>
                  Edit details
                </Button>
              ) : null}
            </div>

            {editing ? (
              <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <TextField label="Full name *" value={draft.fullName} onChange={(v) => setDraft((p) => ({ ...p, fullName: v }))} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField label="Email" type="email" value={draft.email} onChange={(v) => setDraft((p) => ({ ...p, email: v }))} />
                  <TextField label="Phone" value={draft.phone} onChange={(v) => setDraft((p) => ({ ...p, phone: v }))} />
                </div>
                <TextField label="LinkedIn URL" type="url" value={draft.linkedinUrl} onChange={(v) => setDraft((p) => ({ ...p, linkedinUrl: v }))} />
                <TextAreaField label="Notes" value={draft.notes} onChange={(v) => setDraft((p) => ({ ...p, notes: v }))} />
                <FormError message={formError} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => void saveDetails()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            ) : data.notes !== null && data.notes !== '' ? (
              <p style={{ ...TYPE.body, color: 'var(--text-secondary)' }}>{data.notes}</p>
            ) : null}

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 style={TYPE.label}>Affiliations</h3>
                {canEdit ? (
                  <Button variant="ghost" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setShowAdd((s) => !s)}>
                    Add affiliation
                  </Button>
                ) : null}
              </div>

              {showAdd ? (
                <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <SelectField
                    label="Organization *"
                    value={addDraft.clientId}
                    onChange={(v) => setAddDraft((p) => ({ ...p, clientId: v }))}
                    options={[{ value: '', label: '— Select organization —' }, ...orgs.map((o) => ({ value: o.id, label: o.name }))]}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextField label="Role / title" value={addDraft.title} onChange={(v) => setAddDraft((p) => ({ ...p, title: v }))} />
                    <TextField label="Started" type="date" value={addDraft.startedOn} onChange={(v) => setAddDraft((p) => ({ ...p, startedOn: v }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={busy === 'add'}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={() => void addAffiliation()} disabled={busy === 'add'}>
                      {busy === 'add' ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {actionError !== null ? <FormError message={actionError} /> : null}

              {current.length === 0 && past.length === 0 ? (
                <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No affiliations yet.</p>
              ) : (
                <>
                  {current.length > 0 ? (
                    <AffiliationGroup
                      heading="Current"
                      rows={current}
                      canEdit={canEdit}
                      busy={busy}
                      onEnd={(id) => void endAffiliation(id)}
                    />
                  ) : null}
                  {past.length > 0 ? (
                    <AffiliationGroup heading="Past" rows={past} canEdit={false} busy={busy} onEnd={() => undefined} />
                  ) : null}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function AffiliationGroup({
  heading,
  rows,
  canEdit,
  busy,
  onEnd,
}: {
  readonly heading: string;
  readonly rows: readonly AffiliationView[];
  readonly canEdit: boolean;
  readonly busy: string | null;
  readonly onEnd: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{heading}</span>
      <ul className="flex flex-col gap-2">
        {rows.map((a) => {
          const role = a.officeTitle ?? a.title;
          return (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span style={TYPE.bodyStrong}>{a.orgName}</span>
                  <OrgTypeBadge type={a.orgType} />
                </span>
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {role !== null && role !== '' ? `${role} · ` : ''}
                  {tenureLabel(a.startedOn, a.endedOn, a.isCurrent)}
                </span>
              </div>
              {canEdit && a.isCurrent ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<UserMinus size={14} aria-hidden="true" />}
                  onClick={() => onEnd(a.id)}
                  disabled={busy === `end:${a.id}`}
                >
                  {busy === `end:${a.id}` ? 'Ending…' : 'End'}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
