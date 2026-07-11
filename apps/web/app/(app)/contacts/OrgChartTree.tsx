'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import type { OfficeTreeNode, OfficeWithHolder } from '@gracie/shared';

import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Badge } from '@/components/ui/Badge';

import { contactInitials, tenureLabel } from './shared';

/**
 * Org Chart tree (phase `CO`, docs/plan/contacts-org-charts.md §5) — the recursive
 * visual for {@link OrgChartsTab}. Renders the reports-to hierarchy as a nested,
 * indented tree of office cards. Each node shows its title, an optional KEY flag, and
 * either the current holder (avatar + name + tenure) or a VACANT affordance. A vacant
 * KEY office is amber-bordered so gaps we care about stand out. Nodes with children
 * expand/collapse (default expanded). Editors get per-node actions (add child, edit,
 * fill/change holder, vacate, delete); all mutations are delegated up to the tab via
 * callbacks. Viewers see the same chart without action controls.
 */
interface TreeHandlers {
  readonly canEdit: boolean;
  /** Id of the office currently mid-mutation (delete/vacate) — disables its actions. */
  readonly busyOfficeId: string | null;
  readonly onAddChild: (parentOfficeId: string) => void;
  readonly onEditOffice: (office: OfficeWithHolder) => void;
  readonly onSetHolder: (office: OfficeWithHolder) => void;
  readonly onDelete: (office: OfficeWithHolder) => void;
  readonly onVacate: (office: OfficeWithHolder) => void;
}

export function OrgChartTree({
  roots,
  ...handlers
}: TreeHandlers & { readonly roots: readonly OfficeTreeNode[] }): React.JSX.Element {
  return (
    <ul role="tree" aria-label="Org chart" className="flex flex-col gap-2">
      {roots.map((node) => (
        <OrgChartNode key={node.id} node={node} {...handlers} />
      ))}
    </ul>
  );
}

function OrgChartNode({
  node,
  ...handlers
}: TreeHandlers & { readonly node: OfficeTreeNode }): React.JSX.Element {
  const { canEdit, busyOfficeId } = handlers;
  const [expanded, setExpanded] = useState(true);

  const hasChildren = node.children.length > 0;
  const vacant = node.holder === null;
  const keyVacant = node.isKey && vacant;
  const busy = busyOfficeId === node.id;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-label={node.title}>
      <div
        className="flex items-center gap-3 rounded-lg border p-3"
        style={{
          borderColor: keyVacant ? 'var(--color-amber-600)' : 'var(--border-subtle)',
          backgroundColor: keyVacant ? 'var(--color-amber-100)' : '#ffffff',
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
            aria-expanded={expanded}
            onClick={(): void => setExpanded((v) => !v)}
            className="rounded-md p-1"
            style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', lineHeight: 0 }}
          >
            {expanded ? (
              <ChevronDown size={16} aria-hidden="true" />
            ) : (
              <ChevronRight size={16} aria-hidden="true" />
            )}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center"
            style={{ width: 24, color: 'var(--text-secondary)' }}
          >
            <Building2 size={15} />
          </span>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate" style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
              {node.title}
            </span>
            {node.isKey ? (
              <Badge
                bg="var(--color-amber-100)"
                fg="var(--color-amber-600)"
                icon={<Star size={11} aria-hidden="true" />}
              >
                Key
              </Badge>
            ) : null}
          </span>

          {vacant ? (
            canEdit ? (
              <button
                type="button"
                onClick={(): void => handlers.onSetHolder(node)}
                disabled={busy}
                className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5"
                style={{
                  backgroundColor: 'var(--color-amber-100)',
                  color: 'var(--color-amber-600)',
                  ...TYPE.secondary,
                  fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                <UserPlus size={14} aria-hidden="true" />
                Vacant · add contact
              </button>
            ) : (
              <Badge
                bg="var(--color-amber-100)"
                fg="var(--color-amber-600)"
                icon={<UserMinus size={12} aria-hidden="true" />}
              >
                Vacant
              </Badge>
            )
          ) : (
            <span className="flex items-center gap-2">
              <ClientAvatar
                initials={contactInitials(node.holder?.contactName ?? '')}
                size="sm"
                color="var(--color-blue-700)"
              />
              <span className="truncate" style={{ ...TYPE.body, color: 'var(--text-primary)' }}>
                {node.holder?.contactName}
              </span>
              {node.holder?.startedOn !== null && node.holder?.startedOn !== undefined ? (
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  {tenureLabel(node.holder.startedOn, null, true)}
                </span>
              ) : null}
            </span>
          )}
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconBtn
              label={`Add office under ${node.title}`}
              disabled={busy}
              onClick={(): void => handlers.onAddChild(node.id)}
            >
              <Plus size={14} aria-hidden="true" />
            </IconBtn>
            <IconBtn
              label={vacant ? `Fill ${node.title}` : `Change holder for ${node.title}`}
              disabled={busy}
              color="var(--color-blue-700)"
              onClick={(): void => handlers.onSetHolder(node)}
            >
              <UserPlus size={14} aria-hidden="true" />
            </IconBtn>
            {!vacant ? (
              <IconBtn
                label={`Vacate ${node.title}`}
                disabled={busy}
                color="var(--color-amber-600)"
                onClick={(): void => handlers.onVacate(node)}
              >
                <UserMinus size={14} aria-hidden="true" />
              </IconBtn>
            ) : null}
            <IconBtn
              label={`Edit office ${node.title}`}
              disabled={busy}
              onClick={(): void => handlers.onEditOffice(node)}
            >
              <Pencil size={14} aria-hidden="true" />
            </IconBtn>
            <IconBtn
              label={`Delete office ${node.title}`}
              disabled={busy}
              color="var(--color-red-600)"
              onClick={(): void => handlers.onDelete(node)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </IconBtn>
          </div>
        ) : null}
      </div>

      {hasChildren && expanded ? (
        <ul
          role="group"
          className="mt-2 flex flex-col gap-2"
          style={{
            marginLeft: '1.25rem',
            paddingLeft: '1rem',
            borderLeft: '1px solid var(--border-subtle)',
          }}
        >
          {node.children.map((child) => (
            <OrgChartNode key={child.id} node={child} {...handlers} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  color = 'var(--text-secondary)',
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly color?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5"
      style={{
        color,
        background: 'transparent',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  );
}
