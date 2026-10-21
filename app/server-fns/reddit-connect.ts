// ABOUTME: Server functions for Reddit OAuth connection and subreddit flair lookup.
// ABOUTME: Persists refreshable user credentials and exposes only non-sensitive channel settings.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { getChannel, listChannelsByPlatform } from '@/lib/db/queries';
import {
  buildRedditAuthorizeUrl,
  buildRedditCallbackUrl,
  buildRedditChannelInput,
  getRedditConnectConfig,
  normalizeSubreddit,
  type RedditConnectDraft,
  type RedditConnectResult,
} from '@/lib/reddit-connect';
import { getSubredditFlairs, type RedditCreds } from '@/lib/reddit';
import { persistChannel } from './channels';

const StartRedditConnectInput = z.object({
  origin: z.string().url(),
  defaultSubreddit: z.string().trim().min(2).max(100)
    .transform(normalizeSubreddit)
    .refine(value => /^[A-Za-z0-9_]{2,100}$/.test(value), 'Enter a valid subreddit name'),
});

const CompleteRedditConnectInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const RedditFlairsInput = z.object({
  channelId: z.string().min(1),
  subreddit: z.string().trim().min(2).max(100)
    .transform(normalizeSubreddit)
    .refine(value => /^[A-Za-z0-9_]{2,100}$/.test(value), 'Enter a valid subreddit name'),
});

type RedditTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

async function requireAuth() {
  const session = await getSession();
  if (!session.data.userId) throw new Error('Unauthorized');
  return session;
}

async function requireTeamId(): Promise<string> {
  const session = await requireAuth();
  if (!session.data.teamId) throw new Error('No team selected');
  return session.data.teamId;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readPendingRedditConnect(): Promise<RedditConnectDraft> {
  const session = await getSession();
  if (!session.data.redditConnect) {
    throw new Error('Reddit connect session expired. Start again from Channels settings.');
  }
  return session.data.redditConnect;
}

async function clearPendingRedditConnect(): Promise<void> {
  const session = await getSession();
  await session.update({ ...session.data, redditConnect: null });
}

function redditUserAgent(): string {
  return process.env.REDDIT_USER_AGENT || 'web:unheard:1.0';
}

async function exchangeRedditCode(code: string, redirectUri: string): Promise<RedditTokenResponse> {
  const { clientId, clientSecret } = getRedditConnectConfig();
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const payload = await response.json().catch(() => null) as RedditTokenResponse | null;
  if (!response.ok || !payload?.access_token || !payload.refresh_token) {
    throw new Error(payload?.error || `Reddit token exchange failed with ${response.status}`);
  }
  return payload;
}

async function fetchRedditUsername(accessToken: string): Promise<string> {
  const response = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': redditUserAgent(),
    },
  });
  const payload = await response.json().catch(() => null) as { name?: string; message?: string } | null;
  if (!response.ok || !payload?.name) {
    throw new Error(payload?.message || `Reddit account lookup failed with ${response.status}`);
  }
  return payload.name;
}

export const startRedditConnect = createServerFn({ method: 'POST' })
  .inputValidator(StartRedditConnectInput)
  .handler(async ({ data }) => {
    const session = await requireAuth();
    getRedditConnectConfig();
    const state = randomState();
    await session.update({
      ...session.data,
      redditConnect: {
        state,
        origin: data.origin,
        defaultSubreddit: data.defaultSubreddit,
      } satisfies RedditConnectDraft,
    });
    return { url: buildRedditAuthorizeUrl(data.origin, state) };
  });

export const completeRedditConnect = createServerFn({ method: 'POST' })
  .inputValidator(CompleteRedditConnectInput)
  .handler(async ({ data }) => {
    const draft = await readPendingRedditConnect();
    if (draft.state !== data.state) {
      await clearPendingRedditConnect();
      throw new Error('Reddit connect state mismatch. Start again from Channels settings.');
    }

    const token = await exchangeRedditCode(data.code, buildRedditCallbackUrl(draft.origin));
    const username = await fetchRedditUsername(token.access_token!);
    const teamId = await requireTeamId();
    const existing = await listChannelsByPlatform(teamId, 'reddit');

    await persistChannel(buildRedditChannelInput(draft, {
      accessToken: token.access_token!,
      refreshToken: token.refresh_token!,
      expiresIn: token.expires_in ?? 3600,
      username,
    } satisfies RedditConnectResult, existing.length));

    await clearPendingRedditConnect();
    return { username };
  });

export const getRedditFlairs = createServerFn({ method: 'GET' })
  .inputValidator(RedditFlairsInput)
  .handler(async ({ data }) => {
    const teamId = await requireTeamId();
    const channel = await getChannel(data.channelId, teamId);
    if (!channel || channel.platform !== 'reddit') throw new Error('Reddit channel not found');
    const credentials = JSON.parse(await decrypt(channel.credentials)) as RedditCreds;
    return getSubredditFlairs(data.subreddit, credentials);
  });
