// ABOUTME: Server functions for Twitter OAuth connect flow and callback state management.
// ABOUTME: Starts OAuth 1.0a, stores pending state in session, and finalizes channel creation after callback.

import { createServerFn } from '@tanstack/react-start';
import { TwitterApi } from 'twitter-api-v2';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { buildTwitterCallbackUrl, buildTwitterChannelInput, type TwitterConnectDraft, type TwitterConnectResult } from '@/lib/twitter-connect';
import { listChannelsByPlatform } from '@/lib/db/queries';
import { persistChannel } from './channels';

const StartTwitterConnectInput = z.object({
  name: z.string().default(''),
  account_type: z.enum(['personal', 'company', 'page']).default('personal'),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  premium: z.boolean().default(false),
  origin: z.string().url(),
});

const CompleteTwitterConnectInput = z.object({
  oauth_token: z.string().min(1),
  oauth_verifier: z.string().min(1),
});

async function requireAuth() {
  const session = await getSession();
  if (!session.data.userId) {
    throw new Error('Unauthorized');
  }
  return session;
}

function toDraft(data: z.infer<typeof StartTwitterConnectInput>, requestToken: string, requestTokenSecret: string): TwitterConnectDraft {
  return {
    name: data.name.trim(),
    account_type: data.account_type,
    apiKey: data.apiKey,
    apiSecret: data.apiSecret,
    premium: data.premium,
    requestToken,
    requestTokenSecret,
  };
}

async function readPendingTwitterConnect(): Promise<TwitterConnectDraft> {
  const session = await getSession();
  const draft = session.data.twitterConnect;
  if (!draft) {
    throw new Error('Twitter connect session expired. Start again from Channels settings.');
  }
  return draft;
}

async function clearPendingTwitterConnect(): Promise<void> {
  const session = await getSession();
  await session.update({ ...session.data, twitterConnect: null });
}

export const startTwitterConnect = createServerFn({ method: 'POST' })
  .inputValidator(StartTwitterConnectInput)
  .handler(async ({ data }) => {
    await requireAuth();
    const client = new TwitterApi({ appKey: data.apiKey, appSecret: data.apiSecret });
    const callbackUrl = buildTwitterCallbackUrl(data.origin);
    const authLink = await client.generateAuthLink(callbackUrl);
    const session = await getSession();
    await session.update({
      ...session.data,
      twitterConnect: toDraft(data, authLink.oauth_token, authLink.oauth_token_secret),
    });
    return { url: authLink.url };
  });

export const completeTwitterConnect = createServerFn({ method: 'POST' })
  .inputValidator(CompleteTwitterConnectInput)
  .handler(async ({ data }) => {
    await requireAuth();
    const draft = await readPendingTwitterConnect();

    if (draft.requestToken !== data.oauth_token) {
      await clearPendingTwitterConnect();
      throw new Error('Twitter connect token mismatch. Start again from Channels settings.');
    }

    const requestClient = new TwitterApi({
      appKey: draft.apiKey,
      appSecret: draft.apiSecret,
      accessToken: draft.requestToken,
      accessSecret: draft.requestTokenSecret,
    });

    const login = await requestClient.login(data.oauth_verifier);
    
    // Get teamId from session for scoping
    const session = await getSession();
    const teamId = session.data.teamId;
    if (!teamId) {
      throw new Error('No team selected');
    }
    
    const existingTwitterChannels = await listChannelsByPlatform(teamId, 'twitter');

    await persistChannel(buildTwitterChannelInput(draft, {
        accessToken: login.accessToken,
        accessSecret: login.accessSecret,
        screenName: login.screenName,
      } satisfies TwitterConnectResult, existingTwitterChannels.length));

    await clearPendingTwitterConnect();

    return { ok: true, screenName: login.screenName };
  });
