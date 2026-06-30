'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import type { KnowledgeBaseDocumentView } from '@gracie/shared';

import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Knowledge Base upload modal (M9, docs/08 §8). Collects title, file, topic tags,
 * description, expiry, and the AI-active toggle, then POSTs multipart to
 * `/api/knowledge-base`. The frontend never holds MinIO creds — the file bytes are
 * sent to the server, which stores them and enqueues the embedding job (docs/01 §2).
 */
interface KbUploadModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (document: KnowledgeBaseDocumentView) => void;
}

interface FormState {
  readonly title: string;
  readonly tags: string;
  readonly description: string;
  readonly expiration: string;
  readonly aiActive: boolean;
}

const EMPTY: FormState = { title: '', tags: '', description: '', expiration: '', aiActive: true };
const ACCEPTED = '.pdf,.docx,.csv,.txt,.md,.markdown';

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

export function KbUploadModal({ isOpen, onClose, onCreated }: KbUploadModalProps): React.JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function close(): void {
    setForm(EMPTY);
    setFile(null);
    setError(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
    onClose();
  }

  function field(key: keyof Omit<FormState, 'aiActive'>) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [key]: value }));
    };
  }

  async function submit(): Promise<void> {
    const title = form.title.trim();
    if (title === '') {
      setError('Title is required.');
      return;
    }
    if (file === null) {
      setError('Choose a file to upload.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('title', title);
      body.set('file', file);
      body.set('tags', form.tags);
      body.set('description', form.description);
      body.set('expiration', form.expiration);
      body.set('aiActive', form.aiActive ? 'true' : 'false');

      const res = await fetch('/api/knowledge-base', { method: 'POST', body });
      const payload = (await res.json().catch(() => null)) as
        | { document?: KnowledgeBaseDocumentView; error?: { message?: string } }
        | null;
      if (!res.ok) throw new Error(payload?.error?.message ?? `Request failed: ${res.status}`);
      if (payload?.document !== undefined) {
        onCreated(payload.document);
        close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Add knowledge-base document"
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
        <Field label="Title *">
          <input
            className={inputClass}
            style={inputStyle}
            value={form.title}
            onChange={field('title')}
            placeholder="e.g. FedRAMP control mapping"
          />
        </Field>
        <Field label="File *">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className={inputClass}
            style={inputStyle}
            onChange={(event): void => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Topic tags (comma-separated)">
          <input
            className={inputClass}
            style={inputStyle}
            value={form.tags}
            onChange={field('tags')}
            placeholder="security, compliance, onboarding"
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            style={inputStyle}
            rows={3}
            value={form.description}
            onChange={field('description')}
            placeholder="What is this reference document for?"
          />
        </Field>
        <Field label="Expiration date">
          <input
            type="date"
            className={inputClass}
            style={inputStyle}
            value={form.expiration}
            onChange={field('expiration')}
          />
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.aiActive}
            onChange={(event): void => setForm((prev) => ({ ...prev, aiActive: event.target.checked }))}
          />
          <span style={TYPE.body}>Make available to the AI assistant</span>
        </label>
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
