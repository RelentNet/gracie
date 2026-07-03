'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  Building2,
  Users,
  Clock,
  Lock,
} from 'lucide-react';

import { TYPE } from '@/lib/typography';
import { findNodePath, type TreeIcon, type TreeNode } from '@/components/FileBrowser/tree';

/**
 * FolderTree (docs/08 §8 M11) — left panel of the two-panel file browser. Renders
 * the generic `TreeNode` model (see `tree.ts`) for BOTH the client-scoped and the
 * global browser, with per-node expand/collapse.
 *
 * EXPANSION: every branch with children is expanded by default EXCEPT global
 * client nodes (`icon === 'client'`), which start collapsed so the All Clients
 * tree isn't overwhelming. Selecting a node auto-expands the path down to it so
 * the selection stays visible; users can still collapse any branch via its chevron.
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

/** Branches start open unless they're a global client node (kept tidy by default). */
function defaultOpen(node: TreeNode): boolean {
  return node.icon !== 'client';
}

export function FolderTree({ nodes, selectedKey, onSelect }: FolderTreeProps): React.JSX.Element {
  // Explicit user overrides on top of `defaultOpen`; selection auto-expands its path.
  const [expandedOverride, setExpandedOverride] = useState<ReadonlySet<string>>(new Set());
  const [collapsedOverride, setCollapsedOverride] = useState<ReadonlySet<string>>(new Set());

  // Expand the chain down to the current selection so it's never hidden.
  useEffect(() => {
    if (selectedKey === null) return;
    const keys = findNodePath(nodes, selectedKey).map((node) => node.key);
    if (keys.length === 0) return;
    setExpandedOverride((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of keys) if (!next.has(key)) { next.add(key); changed = true; }
      return changed ? next : prev;
    });
    setCollapsedOverride((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of keys) if (next.delete(key)) changed = true;
      return changed ? next : prev;
    });
  }, [nodes, selectedKey]);

  const isOpen = useCallback(
    (node: TreeNode): boolean => {
      if (collapsedOverride.has(node.key)) return false;
      if (expandedOverride.has(node.key)) return true;
      return defaultOpen(node);
    },
    [collapsedOverride, expandedOverride],
  );

  const toggle = useCallback(
    (node: TreeNode): void => {
      const open = isOpen(node);
      setExpandedOverride((prev) => {
        const next = new Set(prev);
        if (open) next.delete(node.key);
        else next.add(node.key);
        return next;
      });
      setCollapsedOverride((prev) => {
        const next = new Set(prev);
        if (open) next.add(node.key);
        else next.delete(node.key);
        return next;
      });
    },
    [isOpen],
  );

  return (
    <nav aria-label="Folders" className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <FolderBranch
          key={node.key}
          node={node}
          selectedKey={selectedKey}
          onSelect={onSelect}
          isOpen={isOpen}
          onToggle={toggle}
        />
      ))}
    </nav>
  );
}

function FolderBranch({
  node,
  selectedKey,
  onSelect,
  isOpen,
  onToggle,
}: {
  readonly node: TreeNode;
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly isOpen: (node: TreeNode) => boolean;
  readonly onToggle: (node: TreeNode) => void;
}): React.JSX.Element {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && isOpen(node);
  return (
    <>
      <FolderRow
        node={node}
        isSelected={selectedKey === node.key}
        hasChildren={hasChildren}
        open={open}
        onSelect={onSelect}
        onToggle={onToggle}
      />
      {open
        ? node.children.map((child) => (
            <FolderBranch
              key={child.key}
              node={child}
              selectedKey={selectedKey}
              onSelect={onSelect}
              isOpen={isOpen}
              onToggle={onToggle}
            />
          ))
        : null}
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
  hasChildren,
  open,
  onSelect,
  onToggle,
}: {
  readonly node: TreeNode;
  readonly isSelected: boolean;
  readonly hasChildren: boolean;
  readonly open: boolean;
  readonly onSelect: (key: string) => void;
  readonly onToggle: (node: TreeNode) => void;
}): React.JSX.Element {
  const Icon = node.icon === 'folder' && (isSelected || open) ? FolderOpen : ICONS[node.icon];
  const iconColor = node.isRestricted ? 'var(--color-red-600)' : 'var(--text-secondary)';
  const rowClass = 'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left';

  const label = (
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

  return (
    <div className="flex items-center" style={{ paddingLeft: `${0.25 + node.depth * 0.875}rem` }}>
      {hasChildren ? (
        <button
          type="button"
          aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
          aria-expanded={open}
          onClick={(): void => onToggle(node)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
          style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : (
        <span aria-hidden="true" className="h-5 w-5 shrink-0" />
      )}

      {node.href !== undefined ? (
        <Link
          href={node.href}
          className={rowClass}
          style={{ color: 'var(--text-primary)', ...TYPE.body }}
        >
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={(): void => onSelect(node.key)}
          aria-current={isSelected ? 'true' : undefined}
          className={rowClass}
          style={{
            backgroundColor: isSelected ? 'var(--color-blue-100)' : 'transparent',
            color: isSelected ? 'var(--color-blue-700)' : 'var(--text-primary)',
            cursor: 'pointer',
            ...TYPE.body,
          }}
        >
          {label}
        </button>
      )}
    </div>
  );
}
