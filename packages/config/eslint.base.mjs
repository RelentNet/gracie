// Shared ESLint flat config base for all workspaces.
// Consumed via `import { baseConfig } from '@gracie/config/eslint'`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce global standards: no `any`; prefer narrowing from `unknown`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
];

export default baseConfig;
