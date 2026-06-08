'use client';

import { useMemo, useState } from 'react';
import { FolderPlus, Upload } from 'lucide-react';
import type { Document, Folder } from '@gracie/shared';

import { getDocumentsByClient, getFoldersByClient } from '@/lib/mock';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import type { Crumb } from '@/components/ui/Breadcrumb';
import { FolderTree } from '@/components/FileBrowser/FolderTree';
import type { FolderNode } from '@/components/FileBrowser/FolderTree';
import { FileList } from '@/components/FileBrowser/FileList';

/**
 * FileBrowser (docs/08 §8 M11) — two-panel folder tree + file list with a
 * breadcrumb, scoped to one client. Phase 2 / UI-only against the MOCK
 * selectors; Phase 1B swaps the selectors for `GET /api/files?clientId=…`.
 *
 * ROLE RULES (docs/08 §1/§7, D14):
 *   - Restricted folders (visibility==='restricted') are OMITTED entirely for
 *     roles not in `allowedRoles` — filtered out here so they never reach the
 *     DOM. Admins see them, marked with a 🔒 in the tree.
 *   - "Upload Here" / "New Folder" and the per-row action icons appear only when
 *     `canEdit()` (editors); viewers get a read-only browser.
 */
export interface FileBrowserProps {
  readonly clientId: string;
}

export function FileBrowser({ clientId }: FileBrowserProps): React.JSX.Element {
  const { hasRole, canEdit } = useAuth();
  const isAdmin = hasRole('admin');
  const editable = canEdit();

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Restricted folders are OMITTED for roles not in allowedRoles (DOM omission).
  const visibleFolders = useMemo<readonly Folder[]>(
    () => getFoldersByClient(clientId).filter((folder) => isVisibleToRole(folder, isAdmin)),
    [clientId, isAdmin],
  );

  const folderNodes = useMemo<readonly FolderNode[]>(
    () => buildFolderTree(visibleFolders),
    [visibleFolders],
  );

  const visibleFolderIds = useMemo<ReadonlySet<string>>(
    () => new Set(visibleFolders.map((folder) => folder.id)),
    [visibleFolders],
  );

  // Documents in the selected folder. "All files" (null) shows everything the
  // role may see: docs in a visible folder, plus unfiled docs (folderId null).
  const documents = useMemo<readonly Document[]>(() => {
    const all = getDocumentsByClient(clientId).filter(
      (doc) => doc.folderId === null || visibleFolderIds.has(doc.folderId),
    );
    if (selectedFolderId === null) return all;
    return all.filter((doc) => doc.folderId === selectedFolderId);
  }, [clientId, selectedFolderId, visibleFolderIds]);

  const breadcrumbItems = useMemo<readonly Crumb[]>(
    () => buildBreadcrumb(visibleFolders, selectedFolderId, setSelectedFolderId),
    [visibleFolders, selectedFolderId],
  );

  return (
    <Card className="p-0">
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b p-4"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <Breadcrumb items={breadcrumbItems} />
        {editable ? (
          <div className="flex items-center gap-2">
            {/* Phase 1B: wire to presigned-URL upload + POST /api/folders. */}
            <Button variant="secondary" size="sm" icon={<FolderPlus aria-hidden="true" size={14} />}>
              New Folder
            </Button>
            <Button variant="primary" size="sm" icon={<Upload aria-hidden="true" size={14} />}>
              Upload Here
            </Button>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-[14rem_1fr]">
        <aside className="border-b p-3 md:border-b-0 md:border-r" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="mb-2 px-2" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            Folders
          </p>
          <FolderTree
            nodes={folderNodes}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            canViewRestricted={isAdmin}
          />
        </aside>
        <div className="p-4">
          <FileList documents={documents} canEdit={editable} />
        </div>
      </div>
    </Card>
  );
}

/** A folder is visible if it is unrestricted, or restricted + role is allowed. */
function isVisibleToRole(folder: Folder, isAdmin: boolean): boolean {
  if (folder.visibility !== 'restricted') return true;
  return isAdmin && folder.allowedRoles.includes('admin');
}

/** Build a depth-annotated tree from flat folders keyed by their `path`. */
function buildFolderTree(folders: readonly Folder[]): readonly FolderNode[] {
  const byPath = new Map<string, Folder>();
  for (const folder of folders) byPath.set(folder.path, folder);

  const childrenOf = new Map<string, Folder[]>();
  const roots: Folder[] = [];

  for (const folder of folders) {
    const parentPath = folder.path.slice(0, folder.path.lastIndexOf('/'));
    if (parentPath !== '' && byPath.has(parentPath)) {
      const siblings = childrenOf.get(parentPath) ?? [];
      siblings.push(folder);
      childrenOf.set(parentPath, siblings);
    } else {
      roots.push(folder);
    }
  }

  function toNode(folder: Folder, depth: number): FolderNode {
    const children = (childrenOf.get(folder.path) ?? []).map((child) => toNode(child, depth + 1));
    return { folder, children, depth };
  }

  return roots.map((root) => toNode(root, 0));
}

/** Breadcrumb trail from the root to the selected folder (via path segments). */
function buildBreadcrumb(
  folders: readonly Folder[],
  selectedFolderId: string | null,
  onSelect: (folderId: string | null) => void,
): readonly Crumb[] {
  const root: Crumb = { label: 'All files', onClick: (): void => onSelect(null) };
  if (selectedFolderId === null) return [root];

  const selected = folders.find((folder) => folder.id === selectedFolderId);
  if (selected === undefined) return [root];

  const byPath = new Map<string, Folder>();
  for (const folder of folders) byPath.set(folder.path, folder);

  // Walk up the path segments collecting ancestor folders that exist.
  const chain: Folder[] = [];
  let currentPath: string | null = selected.path;
  while (currentPath !== null && currentPath !== '') {
    const folder = byPath.get(currentPath);
    if (folder !== undefined) chain.unshift(folder);
    const slashIndex = currentPath.lastIndexOf('/');
    currentPath = slashIndex === -1 ? null : currentPath.slice(0, slashIndex);
  }

  const crumbs: Crumb[] = [root];
  chain.forEach((folder) => {
    crumbs.push({ label: folder.displayName, onClick: (): void => onSelect(folder.id) });
  });
  return crumbs;
}
