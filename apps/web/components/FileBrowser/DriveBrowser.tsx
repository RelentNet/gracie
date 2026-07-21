'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Upload } from 'lucide-react';
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
import { FileList } from '@/components/FileBrowser/FileList';
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

  const refresh = useCallback((): void => setRefreshNonce((n) => n + 1), []);

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
    if (selectedKey === ALL_FILES_KEY || selectedKey === ALL_CLIENTS_KEY) {
      return visibleDocuments;
    }
    if (selectedKey.startsWith(CLIENT_KEY_PREFIX)) {
      const clientId = selectedKey.slice(CLIENT_KEY_PREFIX.length);
      return visibleDocuments.filter((doc) => doc.clientId === clientId);
    }
    return visibleDocuments.filter((doc) => doc.folderId === selectedKey);
  }, [visibleDocuments, selectedKey]);

  const breadcrumbItems = useMemo<readonly Crumb[]>(() => {
    const chain = findNodePath(nodes, selectedKey);
    if (chain.length === 0) {
      return [{ label: isGlobal ? 'All Clients' : 'All files' }];
    }
    return chain
      .filter((node) => node.href === undefined)
      .map((node) => ({ label: node.label, onClick: (): void => setSelectedKey(node.key) }));
  }, [nodes, selectedKey, isGlobal]);

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

  return (
    <Card className="p-0">
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

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[16rem_1fr]">
        <aside
          className="border-b p-3 lg:border-b-0 lg:border-r"
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
        <div className="min-w-0 p-4">
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
            <FileList
              documents={documents}
              canEdit={editable}
              showClient={isGlobal}
              clientName={clientName}
              onMove={editable ? (doc): void => setMoveDoc(doc) : undefined}
              onRename={
                editable ? (doc): void => setRenameTarget({ kind: 'file', document: doc }) : undefined
              }
              onPermissions={
                editable
                  ? (doc): void => setPermissionsTarget({ kind: 'file', document: doc })
                  : undefined
              }
              canDelete={editable ? canDeleteDocument : undefined}
              onDelete={
                editable ? (doc): void => setDeleteTarget({ kind: 'file', document: doc }) : undefined
              }
            />
          )}
        </div>
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
