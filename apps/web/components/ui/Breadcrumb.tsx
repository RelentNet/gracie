import { ChevronRight } from 'lucide-react';

import { TYPE } from '@/lib/typography';

/**
 * Breadcrumb — generic trail primitive (docs/08 §8 M11). Each crumb is either a
 * plain label (current location) or carries an `onClick` to navigate within a
 * client-side view (e.g. the file browser folder path). Reused by the file
 * browser and the later global Documents browser.
 */
export interface Crumb {
  readonly label: string;
  /** When provided, the crumb renders as an interactive button. */
  readonly onClick?: () => void;
}

export interface BreadcrumbProps {
  readonly items: readonly Crumb[];
  readonly ariaLabel?: string;
}

export function Breadcrumb({
  items,
  ariaLabel = 'Breadcrumb',
}: BreadcrumbProps): React.JSX.Element {
  return (
    <nav aria-label={ariaLabel}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.onClick !== undefined && !isLast ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  style={{ ...TYPE.secondary, color: 'var(--color-blue-700)', background: 'transparent', cursor: 'pointer' }}
                >
                  {item.label}
                </button>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  style={{
                    ...TYPE.secondary,
                    color: isLast ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isLast ? 600 : 400,
                  }}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight
                  aria-hidden="true"
                  size={14}
                  style={{ color: 'var(--text-secondary)' }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
