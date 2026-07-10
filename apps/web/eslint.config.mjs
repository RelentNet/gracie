import { baseConfig } from '@gracie/config/eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // The roadmap module is generated from docs/roadmap.html (scripts/gen-roadmap.mjs)
  // and holds one large inlined HTML string — not hand-authored source to lint.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'app/roadmap/roadmap-html.generated.ts',
    ],
  },
  ...baseConfig,
  {
    // Build/tooling scripts run under Node (ESM); the shared base is TS/browser
    // oriented and doesn't register Node globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },
];
