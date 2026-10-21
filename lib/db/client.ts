// ABOUTME: Database client - always uses Cloudflare D1.
// ABOUTME: Worker uses the bound D1 binding; local dev uses the D1 HTTP API against the same remote DB.

import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import * as schema from '../schema';
import { createD1Http } from './d1-http';

type D1Binding = {
  prepare: (...args: unknown[]) => unknown;
  dump?: (...args: unknown[]) => unknown;
  batch?: (...args: unknown[]) => unknown;
  exec?: (...args: unknown[]) => unknown;
};

type Db = ReturnType<typeof drizzleD1<typeof schema>>;

declare global {
  var __contentHubDb__: D1Binding | undefined;
}

let db: Db | null = null;

function resolveBinding(): D1Binding {
  if (globalThis.__contentHubDb__) return globalThis.__contentHubDb__;

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

  if (!apiToken || !accountId || !databaseId) {
    throw new Error(
      'D1 unavailable: no worker DB binding and CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID not set'
    );
  }

  return createD1Http({ accountId, databaseId, apiToken }) as unknown as D1Binding;
}

export async function getDb(): Promise<Db> {
  if (!db) {
    const binding = resolveBinding();
    db = drizzleD1(binding as Parameters<typeof drizzleD1>[0], { schema });
  }
  return db;
}
