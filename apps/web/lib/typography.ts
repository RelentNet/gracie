import type { CSSProperties } from 'react';

/**
 * Typography presets (docs/08 §3). Per the Figma convention, font
 * size/weight/line-height are applied via INLINE styles, not Tailwind text
 * classes. Spread these into a `style` prop:
 *
 *   <h1 style={TYPE.pageTitle}>Dashboard</h1>
 */
export const TYPE = {
  pageTitle: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.2 },
  sectionHeader: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },
  sectionHeaderLg: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3 },
  body: { fontSize: '0.9375rem', fontWeight: 400, lineHeight: 1.5 },
  bodyStrong: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 },
  secondary: { fontSize: '0.8125rem', fontWeight: 400, lineHeight: 1.5 },
  label: {
    fontSize: '0.75rem',
    fontWeight: 600,
    lineHeight: 1.4,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
} as const satisfies Record<string, CSSProperties>;
