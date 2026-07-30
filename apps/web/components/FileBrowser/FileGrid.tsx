'use client';

import { Download, File, FileText, Folder, MoveRight, Pencil, Shield, Trash2 } from 'lucide-react';
import type { Document } from '@gracie/shared';

import { TYPE } from '@/lib/typography';
import { formatFileSize, sourceBadge } from '@/lib/client-display';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/StateViews';
import { fileKind } from '@/components/FileBrowser/file-kind';
import { downloadDocument, FileAction, type FileListProps } from '@/components/FileBrowser/FileList';

/** A drill-in folder/org tile shown in grid view (Explorer-style, folders first). */
export interface GridFolder {
  readonly key: string;
  readonly label: string;
}

export interface FileGridProps extends FileListProps {
  /** Child folders/orgs of the current node, rendered before the files. */
  readonly folders?: readonly GridFolder[];
  /** Navigate INTO a folder card (single click). */
  readonly onOpenFolder?: (key: string) => void;
}

/**
 * FileGrid — the card/grid alternate of {@link FileList} (Dropbox/Drive-style). Same
 * data, same actions, same select-to-preview; only the layout differs. Images show a
 * thumbnail from a presigned URL; other types show a type icon. The list ⇄ grid choice
 * (and its localStorage persistence) live in the parent DriveBrowser.
 *
 * Grid view is tree-less (Windows Explorer): the current folder's child folders are
 * rendered as drill-in cards before the files, so the user navigates by clicking cards
 * and walks back up via the breadcrumb.
 */
export function FileGrid({
  documents,
  canEdit,
  showClient = false,
  clientName,
  onSelect,
  selectedId,
  onMove,
  onRename,
  onPermissions,
  canDelete,
  onDelete,
  folders = [],
  onOpenFolder,
}: FileGridProps): React.JSX.Element {
  if (folders.length === 0 && documents.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="This folder is empty. Generated and uploaded files will appear here."
      />
    );
  }

  // Container queries (not viewport): the file panel is a narrow middle column beside
  // the preview, so columns key off THIS pane's width, not the whole window.
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-4">
        {folders.map((folder) => (
          <button
            key={folder.key}
            type="button"
            onClick={onOpenFolder !== undefined ? (): void => onOpenFolder(folder.key) : undefined}
            title={folder.label}
            className="flex flex-col items-stretch gap-2 rounded-lg border bg-white p-3 text-left"
            style={{
              borderColor: 'var(--border-subtle)',
              cursor: onOpenFolder !== undefined ? 'pointer' : 'default',
            }}
          >
            <span
              className="flex h-24 items-center justify-center rounded-md"
              style={{ backgroundColor: 'var(--color-slate-100)' }}
            >
              <Folder aria-hidden="true" size={28} style={{ color: 'var(--color-blue-600)' }} />
            </span>
            <span className="min-w-0 truncate" style={TYPE.bodyStrong}>
              {folder.label}
            </span>
          </button>
        ))}
        {documents.map((doc) => {
        const source = sourceBadge(doc.sourceBadge);
        const selected = selectedId === doc.id;
        return (
          <div
            key={doc.id}
            className="flex flex-col overflow-hidden rounded-lg border bg-white"
            style={{
              borderColor: selected ? 'var(--color-blue-500)' : 'var(--border-subtle)',
              boxShadow: selected ? '0 0 0 1px var(--color-blue-500)' : undefined,
            }}
          >
            <button
              type="button"
              onClick={onSelect !== undefined ? (): void => onSelect(doc) : undefined}
              className="flex min-w-0 flex-1 flex-col items-stretch gap-2 p-3 text-left"
              style={{ background: 'transparent', cursor: onSelect !== undefined ? 'pointer' : 'default' }}
            >
              <Thumbnail doc={doc} />
              <span className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate" style={TYPE.bodyStrong} title={doc.fileName}>
                  {doc.fileName}
                </span>
                {doc.visibility === 'restricted' ? (
                  <Shield
                    aria-label="Custom permissions"
                    size={12}
                    style={{ color: 'var(--color-red-600)', flexShrink: 0 }}
                  />
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge bg={source.bg} fg={source.fg}>
                  {source.label}
                </Badge>
                {showClient ? (
                  <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
                    {clientName?.(doc.clientId) ?? 'Unassigned'}
                  </Badge>
                ) : null}
                <span className="font-data" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {formatFileSize(doc.fileSize)}
                </span>
              </span>
            </button>

            <span
              className="flex items-center gap-1 border-t px-2 py-1"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <FileAction
                label={`Download ${doc.fileName}`}
                icon={<Download size={16} />}
                onClick={(): void => {
                  void downloadDocument(doc);
                }}
              />
              {canEdit ? (
                <>
                  <FileAction
                    label={`Move ${doc.fileName}`}
                    icon={<MoveRight size={16} />}
                    onClick={onMove !== undefined ? (): void => onMove(doc) : undefined}
                  />
                  <FileAction
                    label={`Rename ${doc.fileName}`}
                    icon={<Pencil size={16} />}
                    onClick={onRename !== undefined ? (): void => onRename(doc) : undefined}
                  />
                  <FileAction
                    label={`Permissions for ${doc.fileName}`}
                    icon={<Shield size={16} />}
                    onClick={onPermissions !== undefined ? (): void => onPermissions(doc) : undefined}
                  />
                  {canDelete?.(doc) === true ? (
                    <FileAction
                      label={`Delete ${doc.fileName}`}
                      icon={<Trash2 size={16} />}
                      danger
                      onClick={onDelete !== undefined ? (): void => onDelete(doc) : undefined}
                    />
                  ) : null}
                </>
              ) : null}
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/**
 * Card thumbnail: an <img> for images (served by the same-origin bytes proxy
 * `/api/files/raw`, which re-authorizes per request), else a type icon. No presigned
 * MinIO URL — the browser can't reach the internal endpoint. A broken/denied image
 * simply shows nothing over the slate background; the icon path covers non-images.
 */
function Thumbnail({ doc }: { readonly doc: Document }): React.JSX.Element {
  const kind = fileKind(doc.r2Key);

  const Icon = kind === 'other' ? File : FileText;
  return (
    <span
      className="flex h-24 items-center justify-center overflow-hidden rounded-md"
      style={{ backgroundColor: 'var(--color-slate-100)' }}
    >
      {kind === 'image' ? (
        // Same-origin proxy URL, not a static asset — plain <img>, not next/image.
        <img
          src={`/api/files/raw?key=${encodeURIComponent(doc.r2Key)}`}
          alt={doc.fileName}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon aria-hidden="true" size={28} style={{ color: 'var(--text-secondary)' }} />
      )}
    </span>
  );
}
