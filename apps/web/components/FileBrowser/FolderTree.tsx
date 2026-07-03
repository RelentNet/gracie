'use client';

import Link from 'next/link';
import {
  BookOpen,
  Folder as FolderIcon,
  FolderOpen,
  Building2,
  Users,
  Clock,
  Lock,
} from 'lucide-react';

import { TYPE } from '@/lib/typography';
import type { TreeIcon, TreeNode } from '@/components/FileBrowser/tree';

/**
 * FolderTree (docs/08 §8 M11) — left panel of the two-panel file browser. Renders
 * the generic `TreeNode` model (see `tree.ts`) for BOTH the client-scoped and the
 * global browser.
 *
 * CRITICAL role rule (docs/08 §1/§7, D14): restricted folders (e.g. Transcripts)
 * are OMITTED entirely for roles not in `allowedRoles` — the caller filters them
 * out before building nodes, so they are absent from the DOM, not shown and
 * locked. Admins DO see restricted folders, marked with a 🔒 lock icon. Nodes
 * with an `href` (e.g. Knowledge Base) render as navigation links.
 */
export type { TreeNode };

export interface FolderTreeProps {
  readonly nodes: readonly TreeNode[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
}

export function FolderTree({ nodes, selectedKey, onSelect }: FolderTreeProps): React.JSX.Element {
  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <FolderBranch
          key={node.key}
          node={node}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function FolderBranch({
  node,
  selectedKey,
  onSelect,
}: {
  readonly node: TreeNode;
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
}): React.JSX.Element {
  return (
    <>
      <FolderRow node={node} isSelected={selectedKey === node.key} onSelect={onSelect} />
      {node.children.map((child) => (
        <FolderBranch key={child.key} node={child} selectedKey={selectedKey} onSelect={onSelect} />
      ))}
    </>
  );
}

const ICONS: Readonly<Record<TreeIcon, typeof FolderIcon>> = {
  folder: FolderIcon,
  clients: Building2,
  client: Users,
  recent: Clock,
  book: BookOpen,
};

function FolderRow({
  node,
  isSelected,
  onSelect,
}: {
  readonly node: TreeNode;
  readonly isSelected: boolean;
  readonly onSelect: (key: string) => void;
}): React.JSX.Element {
  const Icon = node.icon === 'folder' && isSelected ? FolderOpen : ICONS[node.icon];
  const iconColor = node.isRestricted ? 'var(--color-red-600)' : 'var(--text-secondary)';
  const paddingLeft = `${0.5 + node.depth * 0.875}rem`;
  const className = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-left';

  const inner = (
    <>
      <Icon aria-hidden="true" size={16} style={{ color: iconColor }} />
      <span className="truncate">{node.label}</span>
      {node.showLock ? (
        <Lock
          aria-label="Restricted folder"
          size={12}
          style={{ color: 'var(--color-red-600)', marginLeft: 'auto' }}
        />
      ) : null}
    </>
  );

  if (node.href !== undefined) {
    return (
      <Link
        href={node.href}
        className={className}
        style={{ paddingLeft, color: 'var(--text-primary)', ...TYPE.body }}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={(): void => onSelect(node.key)}
      aria-current={isSelected ? 'true' : undefined}
      className={className}
      style={{
        paddingLeft,
        backgroundColor: isSelected ? 'var(--color-blue-100)' : 'transparent',
        color: isSelected ? 'var(--color-blue-700)' : 'var(--text-primary)',
        cursor: 'pointer',
        ...TYPE.body,
      }}
    >
      {inner}
    </button>
  );
}
