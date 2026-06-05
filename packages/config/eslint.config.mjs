// Local lint config for @gracie/config itself. Imports the base via a relative
// path (not the package specifier) to avoid self-referential resolution.
import { baseConfig } from './eslint.base.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ['node_modules/**', 'tsconfig/**'] },
  ...baseConfig,
];
