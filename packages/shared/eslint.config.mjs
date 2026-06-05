import { baseConfig } from '@gracie/config/eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...baseConfig,
];
