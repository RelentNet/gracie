'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Upload } from 'lucide-react';
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
import {
  ALL_CLIENTS_KEY,
  ALL_FILES_KEY,
  CLIENT_KEY_PREFIX,
  KB_KEY,
  RECENT_KEY,
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

/** Recent Documents virtual node size (docs/plan p2fix — last ~20–30 touched). */
const RECENT_LIMIT = 25;

export function DriveBrowser({ scope }: DriveBrowserProps): React.JSX.Element {
  const { hasRole, canEdit } = useAuth();
  const isAdmin = hasRole('admin');
  const editable = canEdit();
  const isGlobal = scope.kind === 'global';
  const scopedClientId = scope.kind === 'client' ? scope.clientId : null;

  const [allFolders, setAllFolders] = useState<readonly Folder[] | null>(null);
  const [allDocuments, setAllDocuments] = useState<readonly Document[] | null>(null);
  const [clients, setClients] = useState<readonly Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedKey, setSelectedKey] = useState<string>(
    isGlobal ? ALL_CLIENTS_KEY : ALL_FILES_KEY,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveDoc, setMoveDoc] = useState<Document | null>(null);

  const refresh = useCallback((): void => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    const query = scopedClientId !== null ? `?clientId=${encodeURIComponent(scopedClientId)}` : '';
    Promise.all([
      apiClient.get<FoldersResponse>(`/api/folders${query}`),
      apiClient.get<DocumentsResponse>(`/api/documents${query}`),
      apiClient.get<ClientsResponse>('/api/clients'),
    ])
      .then(([flds, docs, cls]) => {
        if (!active) return;
        setAllFolders(flds.folders);
        setAllDocuments(docs.documents);
        setClients(cls.clients);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load files');
      });
    return (): void => {
      active = false;
    };
  }, [scopedClientId, refreshNonce]);

  // Defense-in-depth: drop restricted folders a non-admin may not see (the API
  // already omits them). Admins keep the full set.
  const visibleFolders = useMemo<readonly Folder[]>(
    () =>
      (allFolders ?? []).filter(
        (folder) => folder.visibility !== 'restricted' || isAdmin,
      ),
    [allFolders, isAdmin],
  );
  const visibleFolderIds = useMemo<ReadonlySet<string>>(
    () => new Set(visibleFolders.map((folder) => folder.id)),
    [visibleFolders],
  );
  const foldersById = useMemo<ReadonlyMap<string, Folder>>(
    () => new Map(visibleFolders.map((folder) => [folder.id, folder])),
    [visibleFolders],
  );
  const clientName = useCallback(
    (id: string | null): string => {
      if (id === null) return 'Unassigned';
      return (clients ?? []).find((c) => c.id === id)?.name ?? 'Unknown Client';
    },
    [clients],
  );

  // Documents the role may see (restricted-folder docs omitted; unfiled kept).
  const visibleDocuments = useMemo<readonly Document[]>(
    () =>
      (allDocuments ?? []).filter(
        (doc) => doc.folderId === null || visibleFolderIds.has(doc.folderId),
      ),
    [allDocuments, visibleFolderIds],
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
      return [root];
    }

    const sortedClients = [...(clients ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const clientNodes: TreeNode[] = sortedClients.map((client) => ({
      key: clientNodeKey(client.id),
      label: client.name,
      depth: 1,
      icon: 'client',
      isRestricted: false,
      showLock: false,
      children: buildFolderNodes(
        visibleFolders.filter((f) => f.clientId === client.id),
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
    ];
  }, [isGlobal, visibleFolders, clients, isAdmin]);

  // Documents shown in the right panel for the current selection.
  const documents = useMemo<readonly Document[]>(() => {
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

  if (error !== null) {
    return <ErrorState title="Couldn’t load files" description={error} />;
  }
  if (allFolders === null || allDocuments === null || clients === null) {
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

      <div className="grid grid-cols-1 gap-0 md:grid-cols-[16rem_1fr]">
        <aside
          className="border-b p-3 md:border-b-0 md:border-r"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <p className="mb-2 px-2" style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
            Folders
          </p>
          <FolderTree nodes={nodes} selectedKey={selectedKey} onSelect={setSelectedKey} />
        </aside>
        <div className="p-4">
          <FileList
            documents={documents}
            canEdit={editable}
            showClient={isGlobal}
            clientName={clientName}
            onMove={editable ? (doc): void => setMoveDoc(doc) : undefined}
          />
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
    </Card>
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
