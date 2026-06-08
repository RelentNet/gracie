'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Tabs — generic, self-contained tab control with proper ARIA roles
 * (tablist/tab/tabpanel) and keyboard focus (docs/08 §11). Used for in-page
 * sub-sections (e.g. Operations: tasks / pipeline / transcripts). The client
 * PROFILE tabs are route-based and live in the client layout, not here.
 */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  /** Id of the tab selected initially; defaults to the first item. */
  readonly defaultTabId?: string;
  readonly ariaLabel: string;
}

export function Tabs({ items, defaultTabId, ariaLabel }: TabsProps): React.JSX.Element {
  const baseId = useId();
  const [activeId, setActiveId] = useState<string>(defaultTabId ?? items[0]?.id ?? '');
  const activeItem = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {items.map((item) => {
          const isActive = item.id === activeItem?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${item.id}`}
              onClick={(): void => setActiveId(item.id)}
              className="px-4 py-2"
              style={{
                ...TYPE.bodyStrong,
                color: isActive ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                borderBottom: isActive
                  ? '2px solid var(--color-blue-500)'
                  : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem !== undefined ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
