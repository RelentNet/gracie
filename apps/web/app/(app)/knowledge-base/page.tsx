'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';

import type { KbStatus, KnowledgeBaseDocumentView } from '@gracie/shared';

import { useAuth } from '@/lib/auth';
import { formatEasternDate } from '@/lib/format';
import { TYPE } from '@/lib/typography';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { Table, TBody, TCell, THead, TH, TRow } from '@/components/ui/Table';
import { KbUploadModal } from './KbUploadModal';

/**
 * Module 9 — Knowledge Base (docs/08 §8 M9). Lists firm-wide reference documents
 * with topic chips, type, upload date, and status/expiry badges; supports search,
 * tag, and status filters, an upload modal (editors), archive (toggle `ai_active`,
 * editors), and delete (admins). Archiving flips `ai_active=false`, after which the
 * doc stops being retrieved into chat (enforced by `match_kb_embeddings`).
 */
interface KbListResponse {
  readonly documents: readonly KnowledgeBaseDocumentView[];
}

type StatusFilter = 'all' | KbStatus;

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_BADGE: Readonly<Record<KbStatus, { bg: string; fg: string; label: string }>> = {
  active: { bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)', label: 'Active' },
  archived: { bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)', label: 'Archived' },
  expired: { bg: 'var(--color-red-100)', fg: 'var(--color-red-600)', label: 'Expired' },
};

/** Format a `YYYY-MM-DD` date without crossing a timezone day boundary. */
function formatDateOnly(date: string): string {
  return formatEasternDate(`${date}T12:00:00Z`);
}

export default function KnowledgeBasePage(): React.JSX.Element {
  const { canEdit, hasRole } = useAuth();
  const isEditor = canEdit();
  const isAdmin = hasRole('admin');

  const [documents, setDocuments] = useState<readonly KnowledgeBaseDocumentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/knowledge-base')
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | (KbListResponse & { error?: { message?: string } })
          | null;
        if (!res.ok) throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
        if (active) setDocuments(body?.documents ?? []);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load knowledge base');
      });
    return (): void => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (documents === null) return [];
    const query = search.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();
    return documents.filter((doc) => {
      if (statusFilter !== 'all' && doc.status !== statusFilter) return false;
      if (
        query !== '' &&
        !doc.title.toLowerCase().includes(query) &&
        !(doc.description ?? '').toLowerCase().includes(query)
      ) {
        return false;
      }
      if (tag !== '' && !doc.topicTags.some((t) => t.toLowerCase().includes(tag))) return false;
      return true;
    });
  }, [documents, search, tagFilter, statusFilter]);

  async function toggleArchive(doc: KnowledgeBaseDocumentView): Promise<void> {
    setActionError(null);
    try {
      const res = await fetch(`/api/knowledge-base/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiActive: !doc.aiActive }),
      });
      const body = (await res.json().catch(() => null)) as
        | { document?: KnowledgeBaseDocumentView; error?: { message?: string } }
        | null;
      if (!res.ok) throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      if (body?.document !== undefined) {
        const updated = body.document;
        setDocuments((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)));
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update document');
    }
  }

  async function remove(doc: KnowledgeBaseDocumentView): Promise<void> {
    if (!window.confirm(`Delete “${doc.title}”? This removes it and its AI embeddings.`)) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/knowledge-base/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }
      setDocuments((prev) => (prev ?? []).filter((d) => d.id !== doc.id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete document');
    }
  }

  function onCreated(document: KnowledgeBaseDocumentView): void {
    setDocuments((prev) => [document, ...(prev ?? [])]);
  }

  const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" size={20} style={{ color: 'var(--color-blue-700)' }} />
          <div className="flex flex-col gap-0.5">
            <h1 style={TYPE.pageTitle}>Knowledge Base</h1>
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
              Reference documents available to the AI assistant across every client.
            </p>
          </div>
        </div>
        {isEditor ? (
          <Button
            variant="primary"
            icon={<Plus aria-hidden="true" size={16} />}
            onClick={(): void => setModalOpen(true)}
          >
            Add document
          </Button>
        ) : null}
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Search knowledge base"
          className="min-w-48 flex-1 rounded-lg border bg-white px-3 py-2"
          style={inputStyle}
          placeholder="Search title or description…"
          value={search}
          onChange={(event): void => setSearch(event.target.value)}
        />
        <input
          aria-label="Filter by topic tag"
          className="w-40 rounded-lg border bg-white px-3 py-2"
          style={inputStyle}
          placeholder="Topic tag…"
          value={tagFilter}
          onChange={(event): void => setTagFilter(event.target.value)}
        />
        <select
          aria-label="Filter by status"
          className="rounded-lg border bg-white px-3 py-2"
          style={inputStyle}
          value={statusFilter}
          onChange={(event): void => setStatusFilter(event.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {actionError !== null ? (
        <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
          {actionError}
        </p>
      ) : null}

      {error !== null ? (
        <ErrorState title="Couldn’t load knowledge base" description={error} />
      ) : documents === null ? (
        <LoadingState label="Loading knowledge base…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={documents.length === 0 ? 'No knowledge-base documents' : 'No matching documents'}
          description={
            documents.length === 0
              ? 'Upload reference material with topic tags, type, and expiry so the AI assistant can use it.'
              : 'Adjust the search, tag, or status filters to see more documents.'
          }
          action={
            isEditor && documents.length === 0 ? (
              <Button
                variant="primary"
                icon={<Plus aria-hidden="true" size={16} />}
                onClick={(): void => setModalOpen(true)}
              >
                Add document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0">
          <Table>
            <THead>
              <TH>Title</TH>
              <TH>Topics</TH>
              <TH>Type</TH>
              <TH>Uploaded</TH>
              <TH>Status</TH>
              {isEditor ? <TH>Actions</TH> : null}
            </THead>
            <TBody>
              {filtered.map((doc) => {
                const statusBadge = STATUS_BADGE[doc.status];
                return (
                  <TRow key={doc.id}>
                    <TCell>
                      <div className="flex flex-col gap-0.5">
                        <span style={TYPE.bodyStrong}>{doc.title}</span>
                        {doc.description !== null ? (
                          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                            {doc.description}
                          </span>
                        ) : null}
                      </div>
                    </TCell>
                    <TCell>
                      {doc.topicTags.length === 0 ? (
                        <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {doc.topicTags.map((tag) => (
                            <Badge key={tag} bg="var(--color-blue-100)" fg="var(--color-blue-700)">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TCell>
                    <TCell>
                      <span className="font-data" style={TYPE.secondary}>
                        {doc.fileType}
                      </span>
                    </TCell>
                    <TCell>{formatEasternDate(doc.uploadedAt)}</TCell>
                    <TCell>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge bg={statusBadge.bg} fg={statusBadge.fg}>
                          {statusBadge.label}
                        </Badge>
                        {doc.expirationDate !== null && doc.status !== 'expired' ? (
                          <Badge bg="var(--color-amber-100)" fg="var(--color-amber-600)">
                            Expires {formatDateOnly(doc.expirationDate)}
                          </Badge>
                        ) : null}
                      </span>
                    </TCell>
                    {isEditor ? (
                      <TCell>
                        <span className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(): void => void toggleArchive(doc)}
                          >
                            {doc.aiActive ? 'Archive' : 'Unarchive'}
                          </Button>
                          {isAdmin ? (
                            <Button variant="danger" size="sm" onClick={(): void => void remove(doc)}>
                              Delete
                            </Button>
                          ) : null}
                        </span>
                      </TCell>
                    ) : null}
                  </TRow>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      {isEditor ? (
        <KbUploadModal
          isOpen={modalOpen}
          onClose={(): void => setModalOpen(false)}
          onCreated={onCreated}
        />
      ) : null}
    </section>
  );
}
