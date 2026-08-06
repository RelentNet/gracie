'use client';

import { useRef, useState } from 'react';
import { ExternalLink, Pencil } from 'lucide-react';
import { CLIENT_CADENCES, CLIENT_TYPES } from '@gracie/shared';
import type { Client, ClientCadence, ClientType } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { cadenceLabel, clientLogoSrc } from '@/lib/client-display';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ClientAvatar } from '@/components/ClientAvatar';
import { FormError, SelectField, TextField } from '@/components/ui/Field';

const MAX_LOGO_BYTES = 1024 * 1024;
const ACCEPTED_LOGO = 'image/png,image/jpeg,image/svg+xml';

/**
 * Overview → Client Details (P2.1). Read-only facts for viewers; editors get an
 * Edit toggle → inline form → Save (`PATCH /api/clients/:id`). Financial fields are
 * NOT here — they live on the admin-only Finance tab. On save, the parent's client
 * state is updated from the API response. `internal` is excluded from the type picker
 * (the GA workspace type is not manually settable).
 */
const CADENCE_OPTIONS = CLIENT_CADENCES.map((c) => ({ value: c, label: cadenceLabel(c) }));

const TYPE_LABELS: Readonly<Record<ClientType, string>> = {
  client: 'Client',
  prospect: 'Prospect',
  lead: 'Lead',
  partner: 'Partner',
  internal: 'Internal',
  unassigned: 'Unassigned',
};
// `internal` + `unassigned` are system-managed and never manually settable; editing an
// unassigned placeholder's type to a real one is how you promote it to a real client.
const TYPE_OPTIONS = CLIENT_TYPES.filter((t) => t !== 'internal' && t !== 'unassigned').map((t) => ({
  value: t,
  label: TYPE_LABELS[t],
}));

interface DetailsDraft {
  name: string;
  initials: string;
  type: ClientType;
  cadence: ClientCadence;
  primaryContact: string;
  primaryContactEmail: string;
  contractNumber: string;
  driveFolderUrl: string;
}

function toDraft(client: Client): DetailsDraft {
  return {
    name: client.name,
    initials: client.initials,
    type: client.type,
    cadence: client.cadence,
    primaryContact: client.primaryContact ?? '',
    primaryContactEmail: client.primaryContactEmail ?? '',
    contractNumber: client.contractNumber ?? '',
    driveFolderUrl: client.driveFolderUrl ?? '',
  };
}

export function ClientDetailsCard({
  client,
  editable,
  onChange,
}: {
  readonly client: Client;
  readonly editable: boolean;
  readonly onChange: (client: Client) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<DetailsDraft>(() => toDraft(client));
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(): void {
    setDraft(toDraft(client));
    setError(null);
    setEditing(true);
  }

  async function save(): Promise<void> {
    if (saving) return;
    if (draft.name.trim() === '' || draft.initials.trim() === '') {
      setError('Name and initials are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { client: updated } = await apiClient.patch<{ client: Client }>(
        `/api/clients/${client.id}`,
        {
          name: draft.name.trim(),
          initials: draft.initials.trim(),
          type: draft.type,
          cadence: draft.cadence,
          primaryContact: draft.primaryContact,
          primaryContactEmail: draft.primaryContactEmail,
          contractNumber: draft.contractNumber,
          driveFolderUrl: draft.driveFolderUrl,
        },
      );
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Client Details"
        description="Facts used across the profile and in AI generation."
        action={
          editable && !editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1"
              style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', cursor: 'pointer', background: 'transparent' }}
            >
              <Pencil aria-hidden="true" size={14} />
              Edit
            </button>
          ) : undefined
        }
      />

      <ClientLogoField client={client} editable={editable} onChange={onChange} />

      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Name" value={draft.name} onChange={(v): void => setDraft((d) => ({ ...d, name: v }))} required />
            <TextField label="Initials" value={draft.initials} onChange={(v): void => setDraft((d) => ({ ...d, initials: v }))} required />
            <SelectField label="Type" value={draft.type} onChange={(v): void => setDraft((d) => ({ ...d, type: v as ClientType }))} options={TYPE_OPTIONS} />
            <SelectField label="Cadence" value={draft.cadence} onChange={(v): void => setDraft((d) => ({ ...d, cadence: v as ClientCadence }))} options={CADENCE_OPTIONS} />
            <TextField label="Primary contact" value={draft.primaryContact} onChange={(v): void => setDraft((d) => ({ ...d, primaryContact: v }))} />
            <TextField label="Primary contact email" type="email" value={draft.primaryContactEmail} onChange={(v): void => setDraft((d) => ({ ...d, primaryContactEmail: v }))} />
            <TextField label="Contract number" value={draft.contractNumber} onChange={(v): void => setDraft((d) => ({ ...d, contractNumber: v }))} />
            <TextField label="Drive folder URL" type="url" value={draft.driveFolderUrl} onChange={(v): void => setDraft((d) => ({ ...d, driveFolderUrl: v }))} placeholder="https://…" />
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
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <DetailRow label="Type" value={TYPE_LABELS[client.type]} />
            <DetailRow label="Cadence" value={cadenceLabel(client.cadence)} />
            <DetailRow label="Primary contact" value={client.primaryContact} />
            <DetailRow label="Primary contact email" value={client.primaryContactEmail} />
            <DetailRow label="Contract number" value={client.contractNumber} mono />
          </dl>
          <div className="mt-4">
            {client.driveFolderUrl !== null ? (
              <a
                href={client.driveFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5"
                style={{ ...TYPE.secondary, color: 'var(--color-blue-700)' }}
              >
                <ExternalLink aria-hidden="true" size={14} />
                Open Drive folder
              </a>
            ) : (
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No Drive folder linked.</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Client logo — shown instead of the initials avatar (mirrors the firm brand
 * logo). Editors upload/replace/remove; the multipart upload posts straight to
 * `/api/clients/:id/logo` (its own action, not the JSON Save below). Viewers just
 * see the current logo (or nothing). On any change the parent client updates.
 */
function ClientLogoField({
  client,
  editable,
  onChange,
}: {
  readonly client: Client;
  readonly editable: boolean;
  readonly onChange: (client: Client) => void;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState<boolean>(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const logoSrc = clientLogoSrc(client.id, client.logoKey);

  // Viewers with no logo set: nothing to show here.
  if (!editable && logoSrc === null) return null;

  function upload(file: File): void {
    setNote(null);
    if (file.size > MAX_LOGO_BYTES) {
      setNote({ text: 'Logo must be 1 MB or smaller.', ok: false });
      return;
    }
    setBusy(true);
    const body = new FormData();
    body.set('file', file);
    fetch(`/api/clients/${client.id}/logo`, { method: 'POST', body })
      .then(async (res) => {
        const payload = (await res.json().catch(() => null)) as
          | { client?: Client; error?: { message?: string } }
          | null;
        if (!res.ok || payload?.client === undefined) {
          throw new Error(payload?.error?.message ?? 'Upload failed.');
        }
        onChange(payload.client);
        setNote({ text: 'Logo updated.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Upload failed.', ok: false }))
      .finally(() => {
        setBusy(false);
        if (fileInputRef.current !== null) fileInputRef.current.value = '';
      });
  }

  function remove(): void {
    setBusy(true);
    setNote(null);
    apiClient
      .del<{ client: Client }>(`/api/clients/${client.id}/logo`)
      .then(({ client: updated }) => {
        onChange(updated);
        setNote({ text: 'Logo removed — showing initials.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Remove failed.', ok: false }))
      .finally(() => setBusy(false));
  }

  return (
    <fieldset className="mb-4 flex flex-col gap-2 border-b pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
      <legend style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        Client logo — shown instead of the initials
      </legend>
      <div className="flex flex-wrap items-center gap-4">
        {/* Live preview: the logo if set, else the initials avatar it replaces. */}
        <ClientAvatar initials={client.initials} size="lg" logoSrc={logoSrc} />
        {editable ? (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_LOGO}
              disabled={busy}
              aria-label="Choose a client logo image"
              onChange={(e): void => {
                const file = e.target.files?.[0];
                if (file !== undefined) upload(file);
              }}
            />
            {logoSrc !== null ? (
              <Button variant="secondary" disabled={busy} onClick={remove}>
                Remove logo
              </Button>
            ) : null}
            <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              PNG, JPG, or SVG, up to 1 MB. Leave unset to keep the initials.
            </span>
          </div>
        ) : null}
      </div>
      {note !== null ? (
        <span
          role={note.ok ? undefined : 'alert'}
          style={{ ...TYPE.secondary, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
        >
          {note.text}
        </span>
      ) : null}
    </fieldset>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</dt>
      <dd className={mono === true ? 'font-data' : undefined} style={TYPE.body}>
        {value !== null && value !== '' ? value : '—'}
      </dd>
    </div>
  );
}
