// ABOUTME: Server functions for channel CRUD operations (Twitter/LinkedIn/Reddit account credentials).
// ABOUTME: Credentials are encrypted at rest using AES-256-GCM before storing in the DB.
// ABOUTME: Now supports flexible multi-account management with custom groups.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  listChannels as dbListChannels,
  upsertChannel as dbUpsertChannel,
  deleteChannel as dbDeleteChannel,
  getChannel,
  getChannelByPlatformAndType,
  listChannelsByPlatform,
  setDefaultChannel as dbSetDefaultChannel,
  listChannelsByGroup,
  type Channel,
} from '@/lib/db/queries';
import { encrypt, decrypt } from '@/lib/crypto';
import { maxCharacters } from '@/lib/twitter';
import { getSession } from '@/lib/auth';
import { SUPPORTED_PLATFORMS, type PlatformId } from '@/lib/platforms';

const ChannelInput = z.object({
  name: z.string().min(1),
  platform: z.enum(SUPPORTED_PLATFORMS),
  account_type: z.enum(['personal', 'company', 'page']).default('personal'),
  is_default: z.boolean().default(false),
  group_name: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  credentials: z.record(z.string(), z.unknown()),
});

export type ChannelCreateInput = z.infer<typeof ChannelInput>;

const TwitterLimitInput = z.object({
  channel_id: z.string().optional(),
});

export interface ChannelView {
  id: string;
  name: string;
  platform: PlatformId;
  account_type: 'personal' | 'company' | 'page';
  is_default: boolean;
  group_name: string | null;
  account_id: string | null;
  default_subreddit: string | null;
  created_at: number;
}

async function toView(ch: Channel): Promise<ChannelView> {
  let defaultSubreddit: string | null = null;
  if (ch.platform === 'reddit') {
    try {
      const credentials = JSON.parse(await decrypt(ch.credentials)) as { defaultSubreddit?: unknown };
      if (typeof credentials.defaultSubreddit === 'string') {
        defaultSubreddit = credentials.defaultSubreddit;
      }
    } catch {
      defaultSubreddit = null;
    }
  }
  return {
    id: ch.id,
    name: ch.name,
    platform: ch.platform,
    account_type: ch.account_type,
    is_default: ch.is_default,
    group_name: ch.group_name ?? null,
    account_id: ch.account_id ?? null,
    default_subreddit: defaultSubreddit,
    created_at: ch.created_at,
  };
}

function parseTruthy(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

// Helper to get teamId from session
async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getChannels = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ChannelView[]> => {
    const teamId = await getTeamId();
    const channels = await dbListChannels(teamId);
    return Promise.all(channels.map(toView));
  });

export const getChannelsByPlatform = createServerFn({ method: 'GET' })
  .inputValidator((d: { platform: PlatformId }) => z.object({ platform: z.enum(SUPPORTED_PLATFORMS) }).parse(d))
  .handler(async ({ data }): Promise<ChannelView[]> => {
    const teamId = await getTeamId();
    const channels = await listChannelsByPlatform(teamId, data.platform);
    return Promise.all(channels.map(toView));
  });

export const getChannelsByGroup = createServerFn({ method: 'GET' })
  .inputValidator((d: { group_name: string | null }) => d)
  .handler(async ({ data }): Promise<ChannelView[]> => {
    const teamId = await getTeamId();
    const channels = await listChannelsByGroup(teamId, data.group_name);
    return Promise.all(channels.map(toView));
  });

export const getTwitterLimit = createServerFn({ method: 'GET' })
  .inputValidator((d: { channel_id?: string } | undefined) => TwitterLimitInput.parse(d ?? {}))
  .handler(async ({ data }): Promise<{ limit: number; premium: boolean }> => {
    const teamId = await getTeamId();
    const channel = data.channel_id
      ? await getChannel(data.channel_id, teamId)
      : await getDefaultChannelByPlatform(teamId, 'twitter');
    if (!channel) {
      const limit = maxCharacters();
      return { limit, premium: limit > 280 };
    }

    try {
      const raw = await decrypt(channel.credentials);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const premium = parseTruthy(parsed.premium);
      if (premium === undefined) {
        const limit = maxCharacters();
        return { limit, premium: limit > 280 };
      }
      return { limit: premium ? 4000 : 280, premium };
    } catch {
      const limit = maxCharacters();
      return { limit, premium: limit > 280 };
    }
  });

export const createChannel = createServerFn({ method: 'POST' })
  .inputValidator(ChannelInput)
  .handler(async ({ data }): Promise<ChannelView> => persistChannel(data));

export async function persistChannel(data: ChannelCreateInput): Promise<ChannelView> {
  const teamId = await getTeamId();
  const now = Date.now();
  const encrypted = await encrypt(JSON.stringify(data.credentials));
  const existing = data.account_id
    ? (await listChannelsByPlatform(teamId, data.platform)).find(channel => channel.account_id === data.account_id) ?? null
    : null;
  const channelId = existing?.id ?? uuid();

  let isDefault = data.is_default || existing?.is_default || false;
  if (!isDefault && !existing) {
    const platformChannels = await listChannelsByPlatform(teamId, data.platform);
    isDefault = platformChannels.length === 0;
  }

  if (isDefault) {
    await clearDefaultChannels(teamId, data.platform, existing?.id);
  }

  await dbUpsertChannel(
    channelId,
    teamId,
    data.name, 
    data.platform, 
    data.account_type, 
    isDefault, 
    data.group_name ?? null,
    data.account_id ?? null,
    encrypted, 
    now
  );
  
  return {
    id: channelId, 
    name: data.name, 
    platform: data.platform, 
    account_type: data.account_type,
    is_default: isDefault, 
    group_name: data.group_name ?? null,
    account_id: data.account_id ?? null,
    default_subreddit: data.platform === 'reddit' && typeof data.credentials.defaultSubreddit === 'string'
      ? data.credentials.defaultSubreddit
      : null,
    created_at: existing?.created_at ?? now 
  };
}

export const updateChannel = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    id: z.string(),
    name: z.string().min(1).optional(),
    account_type: z.enum(['personal', 'company', 'page']).optional(),
    is_default: z.boolean().optional(),
    group_name: z.string().nullable().optional(),
    account_id: z.string().nullable().optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
  }))
  .handler(async ({ data }): Promise<ChannelView> => {
    const teamId = await getTeamId();
    const existing = await getChannel(data.id, teamId);
    if (!existing) throw new Error('Channel not found');

    const now = Date.now();
    const encrypted = data.credentials 
      ? await encrypt(JSON.stringify(data.credentials))
      : existing.credentials;

    const isDefault = data.is_default ?? existing.is_default;
    
    if (isDefault && !existing.is_default) {
      await clearDefaultChannels(teamId, existing.platform, data.id);
    }

    await dbUpsertChannel(
      data.id,
      teamId,
      data.name ?? existing.name,
      existing.platform,
      data.account_type ?? existing.account_type,
      isDefault,
      data.group_name !== undefined ? data.group_name : (existing.group_name ?? null),
      data.account_id !== undefined ? data.account_id : (existing.account_id ?? null),
      encrypted,
      now
    );

    return toView({
      id: data.id,
      team_id: teamId,
      name: data.name ?? existing.name,
      platform: existing.platform,
      account_type: data.account_type ?? existing.account_type,
      is_default: isDefault,
      group_name: (data.group_name !== undefined ? data.group_name : existing.group_name) ?? null,
      account_id: (data.account_id !== undefined ? data.account_id : existing.account_id) ?? null,
      credentials: encrypted,
      created_at: existing.created_at,
    } satisfies Channel);
  });

export const deleteChannel = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await dbDeleteChannel(data.id, teamId);
    return { ok: true };
  });

export const setDefaultChannel = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await dbSetDefaultChannel(data.id, teamId);
    return { ok: true };
  });

// Helper to clear defaults (exported for use in persistChannel)
async function clearDefaultChannels(teamId: string, platform: PlatformId, excludeId?: string): Promise<void> {
  const { clearDefaultChannels: dbClear } = await import('@/lib/db/queries');
  await dbClear(teamId, platform, excludeId);
}

async function getDefaultChannelByPlatform(teamId: string, platform: PlatformId): Promise<Channel | null> {
  const { getDefaultChannelByPlatform: dbGetDefault } = await import('@/lib/db/queries');
  return dbGetDefault(teamId, platform);
}
