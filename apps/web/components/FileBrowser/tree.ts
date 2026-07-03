/**
 * Shared tree model for the file browsers (docs/08 §8 M11; global view p2fix §5).
 *
 * A `TreeNode` is a generic, keyed row in the left panel. It backs BOTH the
 * client-scoped browser (All files + that client's folders) and the global
 * browser (All Clients → per-client → folders, plus the virtual Recent Documents
 * node and the Knowledge Base nav link). Nodes are identified by a string `key`
 * (folder ids for real folders; sentinels for virtual/synthetic roots) so
 * selection is uniform across both browsers.
 *
 * SECURITY: restricted folders are OMITTED before nodes are built (the caller
 * filters with the same rule the API enforces, docs/02 §D14). `showLock` only
 * annotates a restricted folder an Admin is allowed to see.
 */
import type { Folder } from '@gracie/shared';

export type TreeIcon = 'folder' | 'clients' | 'client' | 'recent' | 'book';

export interface TreeNode {
  /** Unique selection key. `href` nodes are navigational and not selectable. */
  readonly key: string;
  readonly label: string;
  readonly depth: number;
  readonly children: readonly TreeNode[];
  readonly icon: TreeIcon;
  readonly isRestricted: boolean;
  readonly showLock: boolean;
  /** When set, the row is a link (e.g. Knowledge Base) rather than a selection. */
  readonly href?: string;
}

/** Sentinel selection keys for the synthetic/virtual roots. */
export const ALL_FILES_KEY = '__all_files__';
export const ALL_CLIENTS_KEY = '__all_clients__';
export const RECENT_KEY = '__recent__';
export const KB_KEY = '__kb__';

/** Prefix for a per-client node key in the global tree (`client:<id>`). */
export const CLIENT_KEY_PREFIX = 'client:';

export function clientNodeKey(clientId: string): string {
  return `${CLIENT_KEY_PREFIX}${clientId}`;
}

/**
 * Build depth-annotated nodes from a client's flat folders (keyed by `path`).
 * `startDepth` sets the indentation of the roots so the same builder serves the
 * client browser (roots at depth 0) and the global browser (roots nested under a
 * client node). `canViewRestricted` drives the 🔒 annotation only.
 */
export function buildFolderNodes(
  folders: readonly Folder[],
  startDepth: number,
  canViewRestricted: boolean,
): TreeNode[] {
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

  const toNode = (folder: Folder, depth: number): TreeNode => {
    const isRestricted = folder.visibility === 'restricted';
    return {
      key: folder.id,
      label: folder.displayName,
      depth,
      icon: 'folder',
      isRestricted,
      showLock: isRestricted && canViewRestricted,
      children: (childrenOf.get(folder.path) ?? []).map((child) => toNode(child, depth + 1)),
    };
  };

  return roots.map((root) => toNode(root, startDepth));
}

/** DFS the node forest for the chain of nodes from a root down to `key`. */
export function findNodePath(nodes: readonly TreeNode[], key: string): readonly TreeNode[] {
  for (const node of nodes) {
    if (node.key === key) return [node];
    const childPath = findNodePath(node.children, key);
    if (childPath.length > 0) return [node, ...childPath];
  }
  return [];
}
