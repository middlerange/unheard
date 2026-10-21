// ABOUTME: Server functions for self-serve team API key management.
// ABOUTME: Creates agent API keys and returns the raw key only once.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { getSession } from '@/lib/auth';
import { generateApiKey, getApiKeyPrefix, hashApiKey } from '@/lib/api-keys';
import {
  insertApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyView,
} from '@/lib/db/queries';

async function requireTeamUser(): Promise<{ userId: string; teamId: string }> {
  const session = await getSession();
  const userId = session.data.userId;
  const teamId = session.data.teamId;
  if (!userId || !teamId) {
    throw new Error('Unauthorized');
  }
  return { userId, teamId };
}

export const getApiKeys = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ApiKeyView[]> => {
    const { teamId } = await requireTeamUser();
    return listApiKeys(teamId);
  });

export const createApiKey = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string().min(1).max(80) }))
  .handler(async ({ data }): Promise<{ key: string; apiKey: ApiKeyView }> => {
    const { userId, teamId } = await requireTeamUser();
    const key = generateApiKey();
    const now = Date.now();
    const id = uuid();

    await insertApiKey(id, teamId, userId, data.name.trim(), hashApiKey(key), getApiKeyPrefix(key), now);

    return {
      key,
      apiKey: {
        id,
        name: data.name.trim(),
        key_prefix: getApiKeyPrefix(key),
        last_used_at: null,
        revoked_at: null,
        created_at: now,
      },
    };
  });

export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { teamId } = await requireTeamUser();
    await revokeApiKey(data.id, teamId, Date.now());
    return { ok: true };
  });
