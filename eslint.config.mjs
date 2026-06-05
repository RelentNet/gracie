// Root ESLint flat config. This covers loose repo-level files only. Each
// workspace (apps/*, packages/*) provides its own eslint.config.mjs that
// extends the shared base in packages/config (@gracie/config/eslint).
//
// We import the base via a RELATIVE path here (not the @gracie/config package
// specifier) so the root lint never depends on workspace symlink resolution.
import { baseConfig } from './packages/config/eslint.base.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'apps/**',
      'packages/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/*.config.*',
    ],
  },
  ...baseConfig,
];
