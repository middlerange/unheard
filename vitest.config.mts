// ABOUTME: Vitest configuration — separate from main vite.config to avoid TanStack Start plugin.
// ABOUTME: Sets up path aliases and test file patterns.

import { defineConfig } from 'vitest/config';
import viteTsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [viteTsConfigPaths({ projects: ['./tsconfig.json'] })],
  test: {
    include: ['**/*.test.ts'],
  },
});
