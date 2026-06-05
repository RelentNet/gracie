import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TS source (not pre-built) — transpile them here.
  transpilePackages: ['@gracie/shared', '@gracie/db'],
  // The monorepo has a single lockfile at the repo root; pin the tracing root so
  // Next does not mis-detect a stray lockfile elsewhere on the machine.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  typescript: {
    // Types are checked by the dedicated `pnpm typecheck` task across the
    // workspace; keep Next's build check on too for safety.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Linting runs via the dedicated `pnpm lint` task.
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // The shared/db packages are authored in TypeScript with ESM `.js`
    // specifiers (required by tsc's Bundler/NodeNext resolution). Teach webpack
    // to resolve those `.js` import specifiers to the underlying `.ts` source.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
