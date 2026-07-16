'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { UPLOAD_SUBTYPES, type UploadSubtypeValue } from '@/lib/upload-subtypes';

/**
 * Upload modal (docs/08 §8; p2fix §1). Collects file(s), a destination subtype
 * (which folder to file into), an optional title override, and a status, then
 * POSTs multipart to `/api/upload`. The frontend never holds MinIO creds — the
 * bytes are sent to the server (docs/01 §2). Client assignment is required only
 * when no client context is set (the global view with no client selected).
 *
 * The restricted `Transcript` subtype is offered to Admins only, mirroring the
 * server-side gate (docs/02 §D14).
 */
export interface UploadModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onUploaded: () => void;
  readonly clients: readonly { readonly id: string; readonly name: string }[];
  /** Known client context — when set, the client selector is hidden. */
  readonly fixedClientId: string | null;
  readonly fixedClientName: string | null;
  readonly defaultSubtype: UploadSubtypeValue;
  readonly isAdmin: boolean;
  /** The folder the user is currently viewing; upload files into it. Null → the
   *  client's default Uploads folder (chosen by document type). */
  readonly targetFolderId: string | null;
  /** Readable path of the target folder, shown as "Uploading to". */
  readonly targetLabel: string | null;
  /**
   * `'client'` (default) posts to `/api/upload` with a client + subtype. `'staff'`
   * targets the Gracie Files drive: it hides the client + document-type selectors
   * and posts to `/api/staff/upload` (the internal org + `staff/` root are resolved
   * server-side).
   */
  readonly variant?: 'client' | 'staff';
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

const INPUT_CLASS = 'w-full rounded-lg border bg-white px-3 py-2';

export function UploadModal({
  isOpen,
  onClose,
  onUploaded,
  clients,
  fixedClientId,
  fixedClientName,
  defaultSubtype,
  isAdmin,
  targetFolderId,
  targetLabel,
  variant = 'client',
}: UploadModalProps): React.JSX.Element {
  const isStaff = variant === 'staff';
  const [files, setFiles] = useState<FileList | null>(null);
  const [clientId, setClientId] = useState<string>(fixedClientId ?? '');
  const [subtype, setSubtype] = useState<UploadSubtypeValue>(defaultSubtype);
  const [title, setTitle] = useState<string>('');
  const [status, setStatus] = useState<'ready' | 'needs_review'>('ready');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const subtypeOptions = UPLOAD_SUBTYPES.filter((s) => !s.restricted || isAdmin);
  const singleFile = files !== null && files.length === 1;
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  const chosenClientName =
    fixedClientName ?? clients.find((c) => c.id === clientId)?.name ?? null;
  const destination = isStaff
    ? (targetLabel ?? 'Gracie Files')
    : (targetLabel ?? `${chosenClientName ?? 'the selected client'} — Uploads (default)`);

  function close(): void {
    setFiles(null);
    setClientId(fixedClientId ?? '');
    setSubtype(defaultSubtype);
    setTitle('');
    setStatus('ready');
    setError(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
    onClose();
  }

  async function submit(): Promise<void> {
    if (files === null || files.length === 0) {
      setError('Choose at least one file to upload.');
      return;
    }
    const resolvedClientId = fixedClientId ?? clientId;
    if (!isStaff && resolvedClientId === '') {
      setError('Choose a client for this upload.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      if (!isStaff) {
        body.set('clientId', resolvedClientId);
        body.set('subtype', subtype);
      }
      body.set('status', status);
      if (targetFolderId !== null) body.set('folderId', targetFolderId);
      if (singleFile && title.trim() !== '') body.set('title', title.trim());
      for (const file of Array.from(files)) body.append('file', file);

      const res = await fetch(isStaff ? '/api/staff/upload' : '/api/upload', {
        method: 'POST',
        body,
      });
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(payload?.error?.message ?? `Request failed: ${res.status}`);
      onUploaded();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Upload files"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={(): void => void submit()} disabled={submitting}>
            {submitting ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="File(s) *">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={INPUT_CLASS}
            style={inputStyle}
            onChange={(event): void => setFiles(event.target.files)}
          />
        </Field>

        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Uploading to: <strong style={{ color: 'var(--text-primary)' }}>{destination}</strong>
        </p>

        {!isStaff && fixedClientId === null ? (
          <Field label="Client *">
            <select
              className={INPUT_CLASS}
              style={inputStyle}
              value={clientId}
              onChange={(event): void => setClientId(event.target.value)}
            >
              <option value="">Select a client…</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {!isStaff ? (
          <Field label="Document type">
            <select
              className={INPUT_CLASS}
              style={inputStyle}
              value={subtype}
              onChange={(event): void => setSubtype(event.target.value as UploadSubtypeValue)}
            >
              {subtypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {!isStaff && targetFolderId !== null ? (
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Document type only picks the default Uploads folder — it’s ignored when
            you’re uploading into the folder above.
          </span>
        ) : null}

        <Field label={singleFile ? 'Title (optional — defaults to filename)' : 'Title (single-file only)'}>
          <input
            className={INPUT_CLASS}
            style={inputStyle}
            value={title}
            disabled={!singleFile}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => setTitle(event.target.value)}
            placeholder="Override the display name"
          />
        </Field>

        <Field label="Status">
          <select
            className={INPUT_CLASS}
            style={inputStyle}
            value={status}
            onChange={(event): void => setStatus(event.target.value as 'ready' | 'needs_review')}
          >
            <option value="ready">Ready</option>
            <option value="needs_review">Requires Review</option>
          </select>
        </Field>

        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
