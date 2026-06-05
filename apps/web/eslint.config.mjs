import { baseConfig } from '@gracie/config/eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...baseConfig,
];
