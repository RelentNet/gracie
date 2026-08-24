'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, LayoutGrid, List, Upload } from 'lucide-react';
import { canRoleSee, isUnderPath, toVisibilityRule } from '@gracie/shared';
import type { Client, Document, Folder } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { TYPE } from '@/lib/typography';
import type { UploadSubtypeValue } from '@/lib/upload-subtypes';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import type { Crumb } from '@/components/ui/Breadcrumb';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { FolderTree } from '@/components/FileBrowser/FolderTree';
import { FileList, type FileListProps } from '@/components/FileBrowser/FileList';
import { FileGrid } from '@/components/FileBrowser/FileGrid';
import { FilePreview } from '@/components/FileBrowser/FilePreview';
import { UploadModal } from '@/components/FileBrowser/UploadModal';
import { NewFolderModal } from '@/components/FileBrowser/NewFolderModal';
import { MoveModal } from '@/components/FileBrowser/MoveModal';
import { RenameModal } from '@/components/FileBrowser/RenameModal';
import { PermissionsModal, describeAccess } from '@/components/FileBrowser/PermissionsModal';
import { ConfirmDeleteDialog } from '@/components/FileBrowser/ConfirmDeleteDialog';
import { TrashList, type TrashDocument, type TrashFolder } from '@/components/FileBrowser/TrashList';
import {
  ALL_CLIENTS_KEY,
  ALL_FILES_KEY,
  CLIENT_KEY_PREFIX,
  KB_KEY,
  RECENT_KEY,
  TRASH_KEY,
  buildFolderNodes,
  clientNodeKey,
  findNodePath,
  type TreeNode,
} from '@/components/FileBrowser/tree';

/**
 * DriveBrowser (docs/08 §8 M11; global view p2fix §5) — the two-panel folder
 * tree + file list, in one of two scopes:
 *   - `client`: one client's folders (client tab 6); left root is "All files".
 *   - `global`: All Clients → per-client → folders, plus a virtual Recent
 *     Documents node and a Knowledge Base nav link; the list adds a Client column.
 *
 * Editors get working Upload / New Folder / Move; viewers get a read-only browser
 * with Download only.
 *
 * SECURITY (docs/02 §D14, docs/08 §1/§7): restricted folders (e.g. Transcripts)
 * are OMITTED server-side for non-admins by `GET /api/folders|documents`; the
 * client-side `visibleFolders` filter below is defense-in-depth mirroring the API.
 */
export type DriveScope = { readonly kind: 'client'; readonly clientId: string } | { readonly kind: 'global' };

export interface DriveBrowserProps {
  readonly scope: DriveScope;
}

interface FoldersResponse {
  readonly folders: readonly Folder[];
}
interface DocumentsResponse {
  readonly documents: readonly Document[];
}
interface ClientsResponse {
  readonly clients: readonly Client[];
}
/** Orgs that own ≥1 folder/document (any party type) — the global-tree source. */
interface OwnerOrg {
  readonly id: string;
  readonly name: string;
}
interface OwnerOrgsResponse {
  readonly orgs: readonly OwnerOrg[];
}
interface TrashResponse {
  readonly documents: readonly TrashDocument[];
  readonly folders: readonly TrashFolder[];
  readonly retentionDays: number;
}

/** A folder or file the user has opened a manage dialog for. */
type ManageTarget =
  | { readonly kind: 'folder'; readonly folder: Folder }
  | { readonly kind: 'file'; readonly document: Document };

/** Recent Documents virtual node size (docs/plan p2fix — last ~20–30 touched). */
const RECENT_LIMIT = 25;

// Resizable preview-pane bounds (px). Default split favours a wide folder panel and a
// large preview, letting the middle file list ride between them (it has its own
// horizontal scroll region, so a narrow middle degrades gracefully). The clamp keeps
// the preview readable and the file area from collapsing on resize (the tree column is
// only reserved in list view).
const DEFAULT_PREVIEW_WIDTH = 600;
const MIN_PREVIEW_WIDTH = 280;
const MIN_FILE_AREA_WIDTH = 300;
const TREE_COLUMN_WIDTH = 320; // 20rem — keep in sync with the list-view grid template below
const HANDLE_WIDTH = 6;

/** Clamp a requested preview width so neither side collapses (docs/plan resize brief). */
function clampPreviewWidth(raw: number, containerWidth: number, listView: boolean): number {
  const reserved = (listView ? TREE_COLUMN_WIDTH : 0) + HANDLE_WIDTH + MIN_FILE_AREA_WIDTH;
  const max = Math.max(MIN_PREVIEW_WIDTH, Math.min(containerWidth * 0.7, containerWidth - reserved));
  return Math.round(Math.min(Math.max(raw, MIN_PREVIEW_WIDTH), max));
}

export function DriveBrowser({ scope }: DriveBrowserProps): React.JSX.Element {
  const { user, hasRole, canEdit, can } = useAuth();
  const isAdmin = hasRole('admin');
  const editable = canEdit();
  const isGlobal = scope.kind === 'global';
  const scopedClientId = scope.kind === 'client' ? scope.clientId : null;

  const [allFolders, setAllFolders] = useState<readonly Folder[] | null>(null);
  const [allDocuments, setAllDocuments] = useState<readonly Document[] | null>(null);
  const [clients, setClients] = useState<readonly Client[] | null>(null);
  const [owners, setOwners] = useState<readonly OwnerOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedKey, setSelectedKey] = useState<string>(
    isGlobal ? ALL_CLIENTS_KEY : ALL_FILES_KEY,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveDoc, setMoveDoc] = useState<Document | null>(null);
  const [renameTarget, setRenameTarget] = useState<ManageTarget | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<ManageTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManageTarget | null>(null);
  const [trash, setTrash] = useState<TrashResponse | null>(null);
  // The file open in the right-hand preview pane (null = placeholder / closed drawer).
  const [selectedFile, setSelectedFile] = useState<Document | null>(null);
  // List ⇄ grid view for the file panel, persisted in localStorage (SSR-safe: render
  // starts from the 'list' default; the saved choice is applied after mount).
  const [view, setView] = useState<'list' | 'grid'>('list');
  // Draggable preview-pane width (px), fed to the grid's last column via a CSS var
  // and persisted like the view pref. SSR-safe: starts from the default, saved value
  // applied after mount. Both list and grid views share this (same preview column).
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const widthRef = useRef(DEFAULT_PREVIEW_WIDTH);

  const refresh = useCallback((): void => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('documents:view');
      if (saved === 'grid' || saved === 'list') setView(saved);
      const savedWidth = Number(window.localStorage.getItem('documents:previewWidth'));
      if (Number.isFinite(savedWidth) && savedWidth > 0) {
        widthRef.current = savedWidth;
        setPreviewWidth(savedWidth);
      }
    } catch {
      // localStorage unavailable (private mode) — keep the default.
    }
  }, []);

  const changeView = useCallback((next: 'list' | 'grid'): void => {
    setView(next);
    try {
      window.localStorage.setItem('documents:view', next);
    } catch {
      // best-effort persistence only.
    }
  }, []);

  // Apply + remember the preview width. Clamps against the live grid width so neither
  // the preview nor the file area can collapse; persists on drag-end / key press only.
  const applyPreviewWidth = useCallback(
    (raw: number, persist: boolean): void => {
      const containerWidth = gridRef.current?.getBoundingClientRect().width ?? raw;
      const next = clampPreviewWidth(raw, containerWidth, view === 'list');
      widthRef.current = next;
      setPreviewWidth(next);
      if (persist) {
        try {
          window.localStorage.setItem('documents:previewWidth', String(next));
        } catch {
          // best-effort persistence only.
        }
      }
    },
    [view],
  );

  // Pointer-events drag (with pointer capture) so the divider keeps tracking even if
  // the cursor leaves the thin handle mid-drag. Desktop-only: the handle isn't rendered
  // below lg, where the preview is a full-screen drawer instead of a side column.
  const onHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current || gridRef.current === null) return;
      // Preview width = distance from the pointer to the grid's right edge.
      applyPreviewWidth(gridRef.current.getBoundingClientRect().right - e.clientX, false);
    },
    [applyPreviewWidth],
  );

  const onHandlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      applyPreviewWidth(widthRef.current, true);
    },
    [applyPreviewWidth],
  );

  // Keyboard resize (nice-to-have for the separator role): arrows nudge, Home/End jump.
  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = e.shiftKey ? 64 : 16;
      if (e.key === 'ArrowLeft') applyPreviewWidth(widthRef.current + step, true);
      else if (e.key === 'ArrowRight') applyPreviewWidth(widthRef.current - step, true);
      else if (e.key === 'Home') applyPreviewWidth(Number.MAX_SAFE_INTEGER, true);
      else if (e.key === 'End') applyPreviewWidth(0, true);
      else return;
      e.preventDefault();
    },
    [applyPreviewWidth],
  );

  // Changing the folder selection closes the preview (the file may not exist there).
  useEffect(() => {
    setSelectedFile(null);
  }, [selectedKey]);

  useEffect(() => {
    let active = true;
    const query = scopedClientId !== null ? `?clientId=${encodeURIComponent(scopedClientId)}` : '';
    Promise.all([
      apiClient.get<FoldersResponse>(`/api/folders${query}`),
      apiClient.get<DocumentsResponse>(`/api/documents${query}`),
      apiClient.get<ClientsResponse>('/api/clients'),
      apiClient.get<OwnerOrgsResponse>('/api/documents/orgs'),
    ])
      .then(([flds, docs, cls, orgs]) => {
        if (!active) return;
        setAllFolders(flds.folders);
        setAllDocuments(docs.documents);
        setClients(cls.clients);
        setOwners(orgs.orgs);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load files');
      });
    return (): void => {
      active = false;
    };
  }, [scopedClientId, refreshNonce]);

  // The bin is fetched lazily — only once the user actually opens it. Viewers never
  // reach this (the node is not rendered for them, and the API 403s regardless).
  useEffect(() => {
    if (selectedKey !== TRASH_KEY || !editable) return;
    let active = true;
    apiClient
      .get<TrashResponse>('/api/documents/trash')
      .then((data) => {
        if (active) setTrash(data);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load the recycle bin');
      });
    return (): void => {
      active = false;
    };
  }, [selectedKey, editable, refreshNonce]);

  // Defense-in-depth: drop restricted folders this role may not see (the API already
  // omits them). Uses the SAME resolver the server enforces with, so `allowed_roles` is
  // honoured here too — the old mirror ignored the array and hid every restricted
  // folder from every non-admin, which would now disagree with the API.
  const visibleFolders = useMemo<readonly Folder[]>(
    () =>
      (allFolders ?? []).filter((folder) =>
        canRoleSee(toVisibilityRule(folder.visibility, folder.allowedRoles), user.role),
      ),
    [allFolders, user.role],
  );
  const visibleFolderIds = useMemo<ReadonlySet<string>>(
    () => new Set(visibleFolders.map((folder) => folder.id)),
    [visibleFolders],
  );
  const foldersById = useMemo<ReadonlyMap<string, Folder>>(
    () => new Map(visibleFolders.map((folder) => [folder.id, folder])),
    [visibleFolders],
  );
  // id→name from BOTH the client roster and the doc-owner orgs. Owners carry the
  // internal/partner orgs that `/api/clients` omits, so every org that owns a
  // document resolves to its real name instead of "Unknown Client".
  const nameById = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const c of clients ?? []) map.set(c.id, c.name);
    for (const o of owners ?? []) map.set(o.id, o.name);
    return map;
  }, [clients, owners]);
  const clientName = useCallback(
    (id: string | null): string => {
      if (id === null) return 'Unassigned';
      return nameById.get(id) ?? 'Unknown Client';
    },
    [nameById],
  );

  // Documents the role may see: folder ceiling first, then any per-file override.
  const visibleDocuments = useMemo<readonly Document[]>(
    () =>
      (allDocuments ?? []).filter((doc) => {
        if (doc.folderId !== null && !visibleFolderIds.has(doc.folderId)) return false;
        return canRoleSee(toVisibilityRule(doc.visibility, doc.allowedRoles), user.role);
      }),
    [allDocuments, visibleFolderIds, user.role],
  );

  // Pinned at the bottom of the tree, and only for roles that can delete — a viewer
  // has no bin because a viewer can never put anything in one.
  const trashNode = useMemo<TreeNode>(
    () => ({
      key: TRASH_KEY,
      label: 'Recycle Bin',
      depth: 0,
      icon: 'trash',
      isRestricted: false,
      showLock: false,
      children: [],
    }),
    [],
  );

  const nodes = useMemo<readonly TreeNode[]>(() => {
    if (!isGlobal) {
      const root: TreeNode = {
        key: ALL_FILES_KEY,
        label: 'All files',
        depth: 0,
        icon: 'folder',
        isRestricted: false,
        showLock: false,
        children: buildFolderNodes(visibleFolders, 1, isAdmin),
      };
      return editable ? [root, trashNode] : [root];
    }

    // Data-driven: a node per org that actually owns a folder/document (any
    // party type, incl. internal), so GA's Generated Docs appear and doc-less
    // orgs don't clutter the tree (docs/plan documents-area bugs).
    const sortedOwners = [...(owners ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const clientNodes: TreeNode[] = sortedOwners.map((owner) => ({
      key: clientNodeKey(owner.id),
      label: owner.name,
      depth: 1,
      icon: 'client',
      isRestricted: false,
      showLock: false,
      children: buildFolderNodes(
        visibleFolders.filter((f) => f.clientId === owner.id),
        2,
        isAdmin,
      ),
    }));
    return [
      {
        key: ALL_CLIENTS_KEY,
        label: 'All Clients',
        depth: 0,
        icon: 'clients',
        isRestricted: false,
        showLock: false,
        children: clientNodes,
      },
      {
        key: RECENT_KEY,
        label: 'Recent Documents',
        depth: 0,
        icon: 'recent',
        isRestricted: false,
        showLock: false,
        children: [],
      },
      {
        key: KB_KEY,
        label: 'Knowledge Base',
        depth: 0,
        icon: 'book',
        isRestricted: false,
        showLock: false,
        href: '/knowledge-base',
        children: [],
      },
      ...(editable ? [trashNode] : []),
    ];
  }, [isGlobal, visibleFolders, owners, isAdmin, editable, trashNode]);

  // Documents shown in the right panel for the current selection.
  const documents = useMemo<readonly Document[]>(() => {
    if (selectedKey === TRASH_KEY) return [];
    if (selectedKey === RECENT_KEY) {
      return [...visibleDocuments]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RECENT_LIMIT);
    }
    // Explorer behavior: a node shows only the files sitting directly at that level;
    // its subfolders render separately (tree nodes / grid `childFolderNodes` cards).
    // So the top-level and client roots list only unfiled docs (folderId === null),
    // not every doc nested somewhere beneath them.
    if (selectedKey === ALL_FILES_KEY || selectedKey === ALL_CLIENTS_KEY) {
      return visibleDocuments.filter((doc) => doc.folderId === null);
    }
    if (selectedKey.startsWith(CLIENT_KEY_PREFIX)) {
      const clientId = selectedKey.slice(CLIENT_KEY_PREFIX.length);
      return visibleDocuments.filter((doc) => doc.clientId === clientId && doc.folderId === null);
    }
    return visibleDocuments.filter((doc) => doc.folderId === selectedKey);
  }, [visibleDocuments, selectedKey]);

  // Close the preview if its file is gone (deleted, moved away, or filtered out).
  useEffect(() => {
    if (selectedFile !== null && !documents.some((doc) => doc.id === selectedFile.id)) {
      setSelectedFile(null);
    }
  }, [documents, selectedFile]);

  const breadcrumbItems = useMemo<readonly Crumb[]>(() => {
    const chain = findNodePath(nodes, selectedKey);
    if (chain.length === 0) {
      return [{ label: isGlobal ? 'All Clients' : 'All files' }];
    }
    return chain
      .filter((node) => node.href === undefined)
      .map((node) => ({ label: node.label, onClick: (): void => setSelectedKey(node.key) }));
  }, [nodes, selectedKey, isGlobal]);

  // In GRID view the left tree is hidden, so the grid itself carries navigation:
  // the current node's child folders/orgs become Explorer-style drill-in cards.
  // Derived from the SAME tree the list view uses — no extra fetch. `href` nodes
  // (Knowledge Base) are nav links, not drillable folders, so they're excluded.
  const childFolderNodes = useMemo<readonly TreeNode[]>(() => {
    const chain = findNodePath(nodes, selectedKey);
    const current = chain[chain.length - 1];
    return (current?.children ?? []).filter((node) => node.href === undefined);
  }, [nodes, selectedKey]);

  // Client context for the header actions (the selected client, if any).
  const selectedFolder = foldersById.get(selectedKey) ?? null;
  const activeClientId = useMemo<string | null>(() => {
    if (scopedClientId !== null) return scopedClientId;
    if (selectedKey.startsWith(CLIENT_KEY_PREFIX)) return selectedKey.slice(CLIENT_KEY_PREFIX.length);
    return selectedFolder?.clientId ?? null;
  }, [scopedClientId, selectedKey, selectedFolder]);

  const parentFolderId = selectedFolder?.id ?? null;
  const parentLabel =
    selectedFolder?.displayName ??
    (activeClientId !== null ? `${clientName(activeClientId)} (root)` : 'client root');
  const defaultSubtype = subtypeForFolder(selectedFolder);
  // Upload target = the folder currently in view (its breadcrumb as a readable
  // path). `parentFolderId` is that folder's id, or null at a client/All-files root.
  const uploadTargetLabel =
    selectedFolder !== null ? breadcrumbItems.map((crumb) => crumb.label).join(' / ') : null;
  const moveFolders = useMemo<readonly Folder[]>(
    () =>
      moveDoc === null
        ? []
        : visibleFolders.filter((folder) => folder.clientId === moveDoc.clientId),
    [visibleFolders, moveDoc],
  );

  // Can this caller delete THIS file? `file.deleteAny` covers anyone's; otherwise it
  // must be their own upload. Compares against `internalId` (the users.id uuid the FK
  // stores) — `user.id` is the Logto subject and would never match. Fails closed when
  // the internal id is unknown; the server enforces the same rule regardless.
  const canDeleteDocument = useCallback(
    (doc: Document): boolean => {
      if (can('file.deleteAny')) return true;
      if (!can('file.deleteOwn') || user.internalId === null) return false;
      return doc.uploadedByUserId === user.internalId;
    },
    [can, user.internalId],
  );

  const folderActions = useMemo(
    () =>
      editable
        ? {
            onRename: (folderId: string): void => {
              const folder = foldersById.get(folderId);
              if (folder !== undefined) setRenameTarget({ kind: 'folder', folder });
            },
            onPermissions: (folderId: string): void => {
              const folder = foldersById.get(folderId);
              if (folder !== undefined) setPermissionsTarget({ kind: 'folder', folder });
            },
            onDelete: can('folder.delete')
              ? (folderId: string): void => {
                  const folder = foldersById.get(folderId);
                  if (folder !== undefined) setDeleteTarget({ kind: 'folder', folder });
                }
              : undefined,
          }
        : undefined,
    [editable, foldersById, can],
  );

  // How much a folder delete would take with it — shown in the confirm dialog so a
  // recursive delete is never a surprise. Counted from what this role can see, which
  // is a floor, not a guarantee; the server cascades over everything.
  const deleteScope = useMemo(() => {
    if (deleteTarget === null || deleteTarget.kind !== 'folder') return null;
    const path = deleteTarget.folder.path;
    const subfolders = visibleFolders.filter((f) => isUnderPath(f.path, path));
    const subfolderIds = new Set(subfolders.map((f) => f.id));
    const docs = visibleDocuments.filter((d) => d.folderId !== null && subfolderIds.has(d.folderId));
    return { folderCount: subfolders.length, documentCount: docs.length };
  }, [deleteTarget, visibleFolders, visibleDocuments]);

  if (error !== null) {
    return <ErrorState title="Couldn’t load files" description={error} />;
  }
  if (allFolders === null || allDocuments === null || clients === null || owners === null) {
    return (
      <Card className="p-6">
        <LoadingState label="Loading files…" />
      </Card>
    );
  }

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  // One set of props for BOTH the list and grid renderers — same data, same actions,
  // same select-to-preview. The two views are just alternate layouts of this.
  const fileViewProps: FileListProps = {
    documents,
    canEdit: editable,
    showClient: isGlobal,
    clientName,
    onSelect: setSelectedFile,
    selectedId: selectedFile?.id ?? null,
    onMove: editable ? (doc): void => setMoveDoc(doc) : undefined,
    onRename: editable ? (doc): void => setRenameTarget({ kind: 'file', document: doc }) : undefined,
    onPermissions: editable
      ? (doc): void => setPermissionsTarget({ kind: 'file', document: doc })
      : undefined,
    canDelete: editable ? canDeleteDocument : undefined,
    onDelete: editable ? (doc): void => setDeleteTarget({ kind: 'file', document: doc }) : undefined,
  };

  return (
    // Fills the page (width + height). On lg the three panes each scroll
    // independently; on mobile it falls back to natural flow (the app shell scrolls).
    <Card className="flex flex-col p-0 lg:h-full lg:min-h-0">
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b p-4"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <Breadcrumb items={breadcrumbItems} />
        {editable ? (
          <div className="flex items-center gap-2">
            {activeClientId !== null ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<FolderPlus aria-hidden="true" size={14} />}
                onClick={(): void => setNewFolderOpen(true)}
              >
                New Folder
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              icon={<Upload aria-hidden="true" size={14} />}
              onClick={(): void => setUploadOpen(true)}
            >
              Upload Here
            </Button>
          </div>
        ) : null}
      </header>

      {/* `--preview-w` drives the last (preview) column; the 6px column before it is
          the drag handle. Below lg the whole thing collapses to a single column. */}
      <div
        ref={gridRef}
        style={{ '--preview-w': `${previewWidth}px` } as React.CSSProperties}
        className={`grid grid-cols-1 gap-0 lg:min-h-0 lg:flex-1 lg:grid-rows-1 ${
          view === 'grid'
            ? 'lg:grid-cols-[minmax(0,1fr)_6px_var(--preview-w)]'
            : 'lg:grid-cols-[20rem_minmax(0,1fr)_6px_var(--preview-w)]'
        }`}
      >
        {view === 'grid' ? null : (
          <aside
            className="border-b p-3 lg:border-b-0 lg:border-r lg:min-h-0 lg:overflow-y-auto"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <p className="mb-2 px-2" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              Folders
            </p>
            <FolderTree
              nodes={nodes}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              actions={folderActions}
            />
          </aside>
        )}
        <div
          className="min-w-0 border-b p-4 lg:border-b-0 lg:border-r lg:min-h-0 lg:overflow-y-auto"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {selectedKey === TRASH_KEY ? (
            trash === null ? (
              <LoadingState label="Loading recycle bin…" />
            ) : (
              <TrashList
                documents={trash.documents}
                folders={trash.folders}
                clientName={clientName}
                onRestored={refresh}
              />
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {documents.length} {documents.length === 1 ? 'file' : 'files'}
                </span>
                <ViewToggle value={view} onChange={changeView} />
              </div>
              {view === 'grid' ? (
                <FileGrid
                  {...fileViewProps}
                  folders={childFolderNodes}
                  onOpenFolder={setSelectedKey}
                />
              ) : (
                <FileList {...fileViewProps} />
              )}
            </div>
          )}
        </div>
        {/* Drag handle between the file area and the preview (lg only — below lg the
            preview is a drawer, so there's no divider to drag). Pointer capture keeps
            the drag alive off the 6px hit-area; keyboard arrows resize too. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview pane"
          aria-valuemin={MIN_PREVIEW_WIDTH}
          aria-valuenow={Math.round(previewWidth)}
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onKeyDown={onHandleKeyDown}
          className="group hidden touch-none select-none lg:block lg:min-h-0 lg:cursor-col-resize"
          style={{ backgroundColor: 'var(--border-subtle)' }}
        >
          <div className="h-full w-full transition-colors group-hover:bg-[var(--color-blue-400)] group-focus-visible:bg-[var(--color-blue-500)] group-active:bg-[var(--color-blue-500)]" />
        </div>
        {/* Preview: inline third column on lg; a full-screen drawer on mobile when a
            file is selected, and hidden on mobile otherwise. */}
        <section
          className={`bg-white lg:static lg:z-auto lg:block lg:min-h-0 lg:overflow-hidden ${
            selectedFile !== null ? 'fixed inset-0 z-40 overflow-hidden' : 'hidden'
          }`}
        >
          <FilePreview document={selectedFile} onClose={(): void => setSelectedFile(null)} />
        </section>
      </div>

      {/* Modals are mounted only while open so each opening re-initializes its
          form state from the CURRENT selection (subtype, client, parent). */}
      {editable && uploadOpen ? (
        <UploadModal
          isOpen
          onClose={(): void => setUploadOpen(false)}
          onUploaded={refresh}
          clients={clientOptions}
          fixedClientId={activeClientId}
          fixedClientName={activeClientId !== null ? clientName(activeClientId) : null}
          defaultSubtype={defaultSubtype}
          isAdmin={isAdmin}
          targetFolderId={parentFolderId}
          targetLabel={uploadTargetLabel}
        />
      ) : null}
      {editable && newFolderOpen && activeClientId !== null ? (
        <NewFolderModal
          isOpen
          onClose={(): void => setNewFolderOpen(false)}
          onCreated={(folder): void => {
            refresh();
            setSelectedKey(folder.id);
          }}
          clientId={activeClientId}
          parentFolderId={parentFolderId}
          parentLabel={parentLabel}
          isAdmin={isAdmin}
        />
      ) : null}
      {editable && moveDoc !== null ? (
        <MoveModal
          isOpen
          onClose={(): void => setMoveDoc(null)}
          onMoved={refresh}
          document={moveDoc}
          folders={moveFolders}
        />
      ) : null}
      {editable && renameTarget !== null ? (
        <RenameModal
          isOpen
          onClose={(): void => setRenameTarget(null)}
          onRenamed={refresh}
          target={
            renameTarget.kind === 'folder'
              ? { kind: 'folder', id: renameTarget.folder.id, name: renameTarget.folder.displayName }
              : { kind: 'file', id: renameTarget.document.id, name: renameTarget.document.fileName }
          }
        />
      ) : null}
      {editable && permissionsTarget !== null ? (
        <PermissionsModal
          isOpen
          onClose={(): void => setPermissionsTarget(null)}
          onSaved={refresh}
          isAdmin={isAdmin}
          target={
            permissionsTarget.kind === 'folder'
              ? {
                  kind: 'folder',
                  id: permissionsTarget.folder.id,
                  name: permissionsTarget.folder.displayName,
                  visibility: permissionsTarget.folder.visibility,
                  allowedRoles: permissionsTarget.folder.allowedRoles,
                }
              : {
                  kind: 'file',
                  id: permissionsTarget.document.id,
                  name: permissionsTarget.document.fileName,
                  visibility: permissionsTarget.document.visibility,
                  allowedRoles: permissionsTarget.document.allowedRoles,
                  inheritedFrom: inheritedAccess(
                    permissionsTarget.document.folderId,
                    foldersById,
                  ),
                }
          }
        />
      ) : null}
      {editable && deleteTarget !== null ? (
        <ConfirmDeleteDialog
          isOpen
          onClose={(): void => setDeleteTarget(null)}
          onDeleted={(): void => {
            // A deleted folder may be the current selection — fall back to the root
            // so the browser isn't left pointing at a node that no longer exists.
            if (deleteTarget.kind === 'folder' && selectedKey === deleteTarget.folder.id) {
              setSelectedKey(isGlobal ? ALL_CLIENTS_KEY : ALL_FILES_KEY);
            }
            refresh();
          }}
          retentionDays={trash?.retentionDays ?? DEFAULT_RETENTION_DAYS}
          target={
            deleteTarget.kind === 'folder'
              ? {
                  kind: 'folder',
                  id: deleteTarget.folder.id,
                  name: deleteTarget.folder.displayName,
                  folderCount: deleteScope?.folderCount,
                  documentCount: deleteScope?.documentCount,
                }
              : {
                  kind: 'file',
                  id: deleteTarget.document.id,
                  name: deleteTarget.document.fileName,
                }
          }
        />
      ) : null}
    </Card>
  );
}

/**
 * Mirrors the seeded `documents_trash_retention_days`. Only used for the confirm
 * dialog before the bin has been opened once — the real value comes from the API, so
 * the number shown always matches what the purge sweep will actually do.
 */
const DEFAULT_RETENTION_DAYS = 60;

/** What a file currently inherits, for the Permissions dialog's "Inherit" option. */
function inheritedAccess(
  folderId: string | null,
  foldersById: ReadonlyMap<string, Folder>,
): { name: string; summary: string } | null {
  if (folderId === null) return null;
  const folder = foldersById.get(folderId);
  if (folder === undefined) return null;
  return {
    name: folder.displayName,
    summary: describeAccess(folder.visibility, folder.allowedRoles),
  };
}

/** Segmented list ⇄ grid toggle for the file panel (Dropbox/Drive-style). */
function ViewToggle({
  value,
  onChange,
}: {
  readonly value: 'list' | 'grid';
  readonly onChange: (next: 'list' | 'grid') => void;
}): React.JSX.Element {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border"
      style={{ borderColor: 'var(--border-subtle)' }}
      role="group"
      aria-label="File view"
    >
      {(
        [
          { key: 'list', label: 'List view', Icon: List },
          { key: 'grid', label: 'Grid view', Icon: LayoutGrid },
        ] as const
      ).map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={(): void => onChange(key)}
            className="flex h-7 w-8 items-center justify-center"
            style={{
              backgroundColor: active ? 'var(--color-blue-100)' : 'transparent',
              color: active ? 'var(--color-blue-700)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

/** Pre-select the Upload modal's subtype from the currently selected folder. */
function subtypeForFolder(folder: Folder | null): UploadSubtypeValue {
  if (folder === null) return 'other';
  const path = folder.path;
  if (path.endsWith('/transcripts')) return 'transcript';
  if (path.endsWith('/uploads/proposals')) return 'proposal';
  if (path.endsWith('/uploads/capability-decks')) return 'capability_deck';
  if (path.endsWith('/uploads/email-threads')) return 'email_thread';
  return 'other';
}
