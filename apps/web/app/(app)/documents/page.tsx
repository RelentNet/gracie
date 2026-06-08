'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  ExternalLink,
  MoreHorizontal,
  MoveRight,
} from 'lucide-react';
import type { Document, DocumentSource, DocumentStatus, DocumentType, Folder } from '@gracie/shared';
import { DOCUMENT_SOURCES, DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@gracie/shared';

import { MOCK_DOCUMENTS, MOCK_FOLDERS, getClientName, getUserName } from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { formatEasternDate } from '@/lib/format';
import { docStatusBadge, formatFileSize, sourceBadge } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Table, THead, TBody, TRow, TH, TCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/StateViews';

/**
 * Module 5 — Global Documents (docs/08 §8 M5, §7).
 *
 * Flat, filterable view of documents across ALL clients. Filters narrow by
 * client, document type, status, and source. Action icons (Download / Move /
 * More) appear ONLY for editors (`canEdit()`) and are visual-only in Phase 1A/2.
 *
 * RESTRICTED-FOLDER RULE (docs/08 §1/§7, D14): documents that live in a
 * restricted folder (e.g. the CMS Transcripts folder) are OMITTED entirely for
 * non-admins — filtered out here so they never reach the DOM, mirroring the
 * client FileBrowser's `isVisibleToRole` approach and the eventual server
 * omission.
 *
 * Phase 1B: `MOCK_DOCUMENTS` / `MOCK_FOLDERS` are replaced by
 * `GET /api/files` (already role-filtered server-side); the table, filters, and
 * client-side restricted check stay as a defensive second layer.
 */

type ClientFilter = string | 'all';
type TypeFilter = DocumentType | 'all';
type StatusFilter = DocumentStatus | 'all';
type SourceFilter = DocumentSource | 'all';

const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  post_meeting_analysis: 'Post-Meeting Analysis',
  internal_memo: 'Internal Memo',
  client_summary: 'Client Summary',
  task_checklist: 'Task Checklist',
  internal_email_draft: 'Internal Email Draft',
  client_email_draft: 'Client Email Draft',
  pre_meeting_brief: 'Pre-Meeting Brief',
  daily_sync: 'Daily Sync',
  upload: 'Upload',
  other: 'Other',
};

export default function DocumentsPage(): React.JSX.Element {
  const { hasRole, canEdit } = useAuth();
  const isAdmin = hasRole('admin');
  const editable = canEdit();

  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  // Restricted folders → ids omitted for non-admins (DOM omission, like M11).
  const restrictedFolderIds = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        MOCK_FOLDERS.filter((folder) => isRestricted(folder)).map((folder) => folder.id),
      ),
    [],
  );

  // Base set: drop documents in restricted folders unless the user is an admin.
  const visibleDocuments = useMemo<readonly Document[]>(
    () =>
      MOCK_DOCUMENTS.filter((doc) => {
        if (doc.folderId === null) return true;
        if (!restrictedFolderIds.has(doc.folderId)) return true;
        return isAdmin;
      }),
    [restrictedFolderIds, isAdmin],
  );

  const clientOptions = useMemo<readonly string[]>(
    () =>
      Array.from(
        new Set(
          visibleDocuments.flatMap((doc) => (doc.clientId !== null ? [doc.clientId] : [])),
        ),
      ).sort((a, b) => getClientName(a).localeCompare(getClientName(b))),
    [visibleDocuments],
  );

  const filteredDocuments = useMemo<readonly Document[]>(
    () =>
      visibleDocuments.filter((doc) => {
        const matchesClient = clientFilter === 'all' || doc.clientId === clientFilter;
        const matchesType = typeFilter === 'all' || doc.documentType === typeFilter;
        const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
        const matchesSource = sourceFilter === 'all' || doc.sourceBadge === sourceFilter;
        return matchesClient && matchesType && matchesStatus && matchesSource;
      }),
    [visibleDocuments, clientFilter, typeFilter, statusFilter, sourceFilter],
  );

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 style={TYPE.pageTitle}>Documents</h1>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            {filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'} across
            all clients.
          </p>
        </div>
        <KnowledgeBaseLink />
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
          allLabel="All clients"
          options={clientOptions.map((id) => ({ value: id, label: getClientName(id) }))}
        />
        <FilterSelect
          label="Type"
          value={typeFilter}
          onChange={(value): void => setTypeFilter(value as TypeFilter)}
          allLabel="All types"
          options={DOCUMENT_TYPES.map((value) => ({
            value,
            label: DOCUMENT_TYPE_LABELS[value],
          }))}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(value): void => setStatusFilter(value as StatusFilter)}
          allLabel="All statuses"
          options={DOCUMENT_STATUSES.map((value) => ({
            value,
            label: docStatusBadge(value).label,
          }))}
        />
        <FilterSelect
          label="Source"
          value={sourceFilter}
          onChange={(value): void => setSourceFilter(value as SourceFilter)}
          allLabel="All sources"
          options={DOCUMENT_SOURCES.map((value) => ({ value, label: sourceBadge(value).label }))}
        />
      </div>

      {filteredDocuments.length === 0 ? (
        <EmptyState
          title="No matching documents"
          description="No documents match the current filters. Adjust the client, type, status, or source filters to see results."
        />
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Client</TH>
            <TH>Type</TH>
            <TH>Date</TH>
            <TH>Uploaded By</TH>
            <TH>Size</TH>
            <TH>Status</TH>
            {editable ? (
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            ) : null}
          </THead>
          <TBody>
            {filteredDocuments.map((doc) => {
              const source = sourceBadge(doc.sourceBadge);
              const status = docStatusBadge(doc.status);
              return (
                <TRow key={doc.id}>
                  <TCell>
                    <span style={TYPE.bodyStrong}>{doc.fileName}</span>
                  </TCell>
                  <TCell>
                    <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
                      {getClientName(doc.clientId)}
                    </Badge>
                  </TCell>
                  <TCell>
                    <Badge bg={source.bg} fg={source.fg}>
                      {DOCUMENT_TYPE_LABELS[doc.documentType]}
                    </Badge>
                  </TCell>
                  <TCell>{formatEasternDate(doc.createdAt)}</TCell>
                  <TCell>
                    {doc.uploadedByUserId !== null ? getUserName(doc.uploadedByUserId) : 'System'}
                  </TCell>
                  <TCell>
                    <span className="font-data">{formatFileSize(doc.fileSize)}</span>
                  </TCell>
                  <TCell>
                    <Badge bg={status.bg} fg={status.fg}>
                      {status.label}
                    </Badge>
                  </TCell>
                  {editable ? (
                    <TCell>
                      <span className="flex items-center gap-1">
                        <RowAction label={`Download ${doc.fileName}`} icon={<Download size={16} />} />
                        <RowAction label={`Move ${doc.fileName}`} icon={<MoveRight size={16} />} />
                        <RowAction
                          label={`More actions for ${doc.fileName}`}
                          icon={<MoreHorizontal size={16} />}
                        />
                      </span>
                    </TCell>
                  ) : null}
                </TRow>
              );
            })}
          </TBody>
        </Table>
      )}
    </section>
  );
}

/** Knowledge Base entry (docs/08 §8 M5) — navigates to the KB module. */
function KnowledgeBaseLink(): React.JSX.Element {
  return (
    <Card className="p-3">
      <Link
        href="/knowledge-base"
        className="flex items-center gap-2"
        style={{ ...TYPE.bodyStrong, color: 'var(--color-blue-700)' }}
      >
        <BookOpen aria-hidden="true" size={18} />
        <span>Knowledge Base</span>
        <ExternalLink aria-hidden="true" size={14} />
      </Link>
    </Card>
  );
}

function RowAction({
  label,
  icon,
}: {
  readonly label: string;
  readonly icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1"
      style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
    >
      {icon}
    </button>
  );
}

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  readonly label: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly allLabel: string;
  readonly options: readonly FilterOption[];
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>{label}</span>
      <select
        value={value}
        onChange={(event): void => onChange(event.target.value as T)}
        className="rounded-lg border bg-white px-3 py-2"
        style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A folder is restricted if its visibility is `restricted` (Transcripts, etc). */
function isRestricted(folder: Folder): boolean {
  return folder.visibility === 'restricted';
}
