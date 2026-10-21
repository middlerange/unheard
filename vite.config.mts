// ABOUTME: Vite configuration for TanStack Start.
// ABOUTME: Registers TanStack Start, React, Tailwind, and path alias plugins.

import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { getPlatformProxy } from 'wrangler';

const root = fileURLToPath(new URL('.', import.meta.url));

const nodeStreamShim = {
  name: 'node-stream-shim',
  enforce: 'pre' as const,
  resolveId(id: string, _importer: string | undefined, options: { ssr?: boolean }) {
    if (options?.ssr) return;
    if (id === 'node:stream') return `${root}shims/node-stream.ts`;
    if (id === 'node:stream/web') return `${root}shims/node-stream-web.ts`;
    if (id === 'node:async_hooks') return `${root}shims/node-async-hooks.ts`;
  },
};

const localD1 = {
  name: 'content-hub-local-d1',
  async configureServer(server: { httpServer: import('node:http').Server | null }) {
    const platform = await getPlatformProxy({
      configPath: `${root}wrangler.toml`,
      envFiles: [],
      persist: true,
      remoteBindings: false,
    });
    globalThis.__contentHubDb__ = platform.env.DB as typeof globalThis.__contentHubDb__;
    server.httpServer?.once('close', () => {
      if (globalThis.__contentHubDb__ === platform.env.DB) {
        delete globalThis.__contentHubDb__;
      }
      void platform.dispose();
    });
  },
};

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3003,
    watch: {
      ignored: ['**/.tanstack/**', '**/routeTree.gen.ts'],
    },
  },
  plugins: [
    localD1,
    nodeStreamShim,
    tailwindcss(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({ srcDirectory: 'app', server: { preset: 'cloudflare-module' } }),
    viteReact(),
  ],
});
