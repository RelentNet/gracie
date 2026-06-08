'use client';

import { Folder as FolderIcon, FolderOpen, Lock } from 'lucide-react';
import type { Folder } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

/**
 * FolderTree (docs/08 §8 M11) — left panel of the two-panel file browser.
 *
 * CRITICAL role rule (docs/08 §1/§7, D14): restricted folders (e.g. Transcripts)
 * are OMITTED entirely for roles not in `allowedRoles` — the caller filters them
 * out before passing `folders` here, so they are absent from the DOM, not shown
 * and locked. Admins DO see restricted folders, marked with a 🔒 lock icon.
 */
export interface FolderNode {
  readonly folder: Folder;
  readonly children: readonly FolderNode[];
  /** Depth for indentation. */
  readonly depth: number;
}

export interface FolderTreeProps {
  readonly nodes: readonly FolderNode[];
  readonly selectedFolderId: string | null;
  readonly onSelect: (folderId: string | null) => void;
  /** Whether the current user may view restricted folders (admin). Drives 🔒. */
  readonly canViewRestricted: boolean;
}

export function FolderTree({
  nodes,
  selectedFolderId,
  onSelect,
  canViewRestricted,
}: FolderTreeProps): React.JSX.Element {
  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5">
      <FolderRow
        label="All files"
        isSelected={selectedFolderId === null}
        isRestricted={false}
        showLock={false}
        depth={0}
        onSelect={(): void => onSelect(null)}
      />
      {nodes.map((node) => (
        <FolderBranch
          key={node.folder.id}
          node={node}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          canViewRestricted={canViewRestricted}
        />
      ))}
    </nav>
  );
}

function FolderBranch({
  node,
  selectedFolderId,
  onSelect,
  canViewRestricted,
}: {
  readonly node: FolderNode;
  readonly selectedFolderId: string | null;
  readonly onSelect: (folderId: string | null) => void;
  readonly canViewRestricted: boolean;
}): React.JSX.Element {
  const isRestricted = node.folder.visibility === 'restricted';
  return (
    <>
      <FolderRow
        label={node.folder.displayName}
        isSelected={selectedFolderId === node.folder.id}
        isRestricted={isRestricted}
        showLock={isRestricted && canViewRestricted}
        depth={node.depth}
        onSelect={(): void => onSelect(node.folder.id)}
      />
      {node.children.map((child) => (
        <FolderBranch
          key={child.folder.id}
          node={child}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          canViewRestricted={canViewRestricted}
        />
      ))}
    </>
  );
}

function FolderRow({
  label,
  isSelected,
  isRestricted,
  showLock,
  depth,
  onSelect,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly isRestricted: boolean;
  readonly showLock: boolean;
  readonly depth: number;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const Icon = isSelected ? FolderOpen : FolderIcon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
      style={{
        paddingLeft: `${0.5 + depth * 0.875}rem`,
        backgroundColor: isSelected ? 'var(--color-blue-100)' : 'transparent',
        color: isSelected ? 'var(--color-blue-700)' : 'var(--text-primary)',
        cursor: 'pointer',
        ...TYPE.body,
      }}
    >
      <Icon
        aria-hidden="true"
        size={16}
        style={{ color: isRestricted ? 'var(--color-red-600)' : 'var(--text-secondary)' }}
      />
      <span className="truncate">{label}</span>
      {showLock ? (
        <Lock
          aria-label="Restricted folder"
          size={12}
          style={{ color: 'var(--color-red-600)', marginLeft: 'auto' }}
        />
      ) : null}
    </button>
  );
}
