// ABOUTME: OAuth connect flows for LinkedIn, Meta (Facebook + Instagram), and YouTube.
// ABOUTME: Uses server-side app credentials so end users connect channels with one authorization instead of manual tokens.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { decrypt, encrypt } from '@/lib/crypto';
import { listChannelsByPlatform, upsertChannel as dbUpsertChannel } from '@/lib/db/queries';
import { isRedditConnectConfigured } from '@/lib/reddit-connect';
import {
  buildLinkedInAuthorizeUrl,
  buildLinkedInCallbackUrl,
  buildMetaAuthorizeUrl,
  buildMetaCallbackUrl,
  buildYouTubeAuthorizeUrl,
  buildYouTubeCallbackUrl,
  getLinkedInConnectConfig,
  getMetaConnectConfig,
  getYouTubeConnectConfig,
  isLinkedInConnectConfigured,
  isMetaConnectConfigured,
  isYouTubeConnectConfigured,
  META_API_VERSION,
  type LinkedInConnectDraft,
  type MetaConnectDraft,
  type YouTubeConnectDraft,
} from '@/lib/social-connect';
import { persistChannel } from './channels';

const StartMetaConnectInput = z.object({
  origin: z.string().url(),
});

const CompleteMetaConnectInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const StartYouTubeConnectInput = z.object({
  origin: z.string().url(),
  name: z.string().default(''),
  account_type: z.enum(['personal', 'company', 'page']).default('company'),
  privacyStatus: z.enum(['private', 'unlisted', 'public']).default('private'),
  notifySubscribers: z.boolean().default(false),
});

const CompleteYouTubeConnectInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const StartLinkedInConnectInput = z.object({
  origin: z.string().url(),
});

const CompleteLinkedInConnectInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string | null } | null;
  connected_instagram_account?: { id: string; username?: string | null } | null;
};

type YouTubeTokenResponse = {
  access_token: string;
  refresh_token?: string;
};

type LinkedInTokenResponse = {
  access_token: string;
};

type LinkedInProfile = {
  id: string;
  name?: string;
  localizedFirstName?: string;
  localizedLastName?: string;
};

async function requireAuth() {
  const session = await getSession();
  if (!session.data.userId) {
    throw new Error('Unauthorized');
  }
  return session;
}

async function requireTeamId(): Promise<string> {
  const session = await requireAuth();
  if (!session.data.teamId) {
    throw new Error('No team selected');
  }
  return session.data.teamId;
}

function randomState(): string {
  return crypto.randomUUID();
}

async function readPendingMetaConnect(): Promise<MetaConnectDraft> {
  const session = await getSession();
  const draft = session.data.metaConnect;
  if (!draft) {
    throw new Error('Meta connect session expired. Start again from Channels settings.');
  }
  return draft;
}

async function clearPendingMetaConnect(): Promise<void> {
  const session = await getSession();
  await session.update({ ...session.data, metaConnect: null });
}

async function readPendingYouTubeConnect(): Promise<YouTubeConnectDraft> {
  const session = await getSession();
  const draft = session.data.youtubeConnect;
  if (!draft) {
    throw new Error('YouTube connect session expired. Start again from Channels settings.');
  }
  return draft;
}

async function clearPendingYouTubeConnect(): Promise<void> {
  const session = await getSession();
  await session.update({ ...session.data, youtubeConnect: null });
}

async function readPendingLinkedInConnect(): Promise<LinkedInConnectDraft> {
  const session = await getSession();
  const draft = session.data.linkedinConnect;
  if (!draft) {
    throw new Error('LinkedIn connect session expired. Start again from Channels settings.');
  }
  return draft;
}

async function clearPendingLinkedInConnect(): Promise<void> {
  const session = await getSession();
  await session.update({ ...session.data, linkedinConnect: null });
}

async function metaRequest<T>(url: string | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | T | null;
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message ?? `Meta request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function exchangeMetaCode(code: string, redirectUri: string): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaConnectConfig();
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  return metaRequest<MetaTokenResponse>(url);
}

async function exchangeLongLivedMetaToken(accessToken: string): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getMetaConnectConfig();
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', accessToken);
  return metaRequest<MetaTokenResponse>(url);
}

async function listMetaPages(userAccessToken: string): Promise<MetaPage[]> {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}');
  url.searchParams.set('access_token', userAccessToken);
  const payload = await metaRequest<{ data?: MetaPage[] }>(url);
  return payload.data ?? [];
}

async function exchangeYouTubeCode(code: string, redirectUri: string): Promise<YouTubeTokenResponse> {
  const { clientId, clientSecret } = getYouTubeConnectConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => null) as { error_description?: string; error?: string } & Partial<YouTubeTokenResponse>;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? `Google token exchange failed with ${response.status}`);
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  };
}

async function fetchYouTubeChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null) as {
    error?: { message?: string };
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `YouTube channel lookup failed with ${response.status}`);
  }

  const channel = payload?.items?.[0];
  if (!channel?.id) {
    throw new Error('No YouTube channel was returned for this Google account.');
  }

  return {
    id: channel.id,
    title: channel.snippet?.title?.trim() || 'YouTube Channel',
  };
}

async function exchangeLinkedInCode(code: string, redirectUri: string): Promise<LinkedInTokenResponse> {
  const { clientId, clientSecret } = getLinkedInConnectConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => null) as ({ error_description?: string; error?: string } & Partial<LinkedInTokenResponse>) | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description ?? payload?.error ?? `LinkedIn token exchange failed with ${response.status}`);
  }
  return { access_token: payload.access_token };
}

async function fetchLinkedInProfile(accessToken: string): Promise<LinkedInProfile> {
  const response = await fetch('https://api.linkedin.com/v2/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  const payload = await response.json().catch(() => null) as (Partial<LinkedInProfile> & { message?: string }) | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.message ?? `LinkedIn profile lookup failed with ${response.status}`);
  }
  return payload as LinkedInProfile;
}

export const getConnectAvailability = createServerFn({ method: 'GET' })
  .handler(async () => ({
    linkedin: isLinkedInConnectConfigured(),
    reddit: isRedditConnectConfigured(),
    meta: isMetaConnectConfigured(),
    youtube: isYouTubeConnectConfigured(),
  }));

export const startLinkedInConnect = createServerFn({ method: 'POST' })
  .inputValidator(StartLinkedInConnectInput)
  .handler(async ({ data }) => {
    const session = await requireAuth();
    getLinkedInConnectConfig();
    const state = randomState();
    await session.update({
      ...session.data,
      linkedinConnect: { state, origin: data.origin } satisfies LinkedInConnectDraft,
    });
    return { url: buildLinkedInAuthorizeUrl(data.origin, state) };
  });

export const completeLinkedInConnect = createServerFn({ method: 'POST' })
  .inputValidator(CompleteLinkedInConnectInput)
  .handler(async ({ data }) => {
    await requireAuth();
    const draft = await readPendingLinkedInConnect();
    if (draft.state !== data.state) {
      await clearPendingLinkedInConnect();
      throw new Error('LinkedIn connect state mismatch. Start again from Channels settings.');
    }

    const token = await exchangeLinkedInCode(data.code, buildLinkedInCallbackUrl(draft.origin));
    const profile = await fetchLinkedInProfile(token.access_token);
    const teamId = await requireTeamId();
    const now = Date.now();
    const existing = await listChannelsByPlatform(teamId, 'linkedin');
    const personal = existing.find(channel => channel.account_type === 'personal');

    for (const channel of existing) {
      let credentials: Record<string, unknown> = {};
      try {
        credentials = JSON.parse(await decrypt(channel.credentials)) as Record<string, unknown>;
      } catch {
        credentials = {};
      }
      credentials.accessToken = token.access_token;
      await dbUpsertChannel(
        channel.id,
        teamId,
        channel.name,
        channel.platform,
        channel.account_type,
        channel.is_default,
        channel.group_name ?? (channel.account_type === 'personal' ? 'personal' : 'company'),
        channel.account_id ?? (channel.account_type === 'personal' ? profile.id : null),
        await encrypt(JSON.stringify(credentials)),
        now,
      );
    }

    const profileName = profile.name?.trim()
      || [profile.localizedFirstName, profile.localizedLastName].filter(Boolean).join(' ').trim()
      || 'LinkedIn Profile';

    if (!personal) {
      await persistChannel({
        name: profileName,
        platform: 'linkedin',
        account_type: 'personal',
        is_default: existing.length === 0,
        group_name: 'personal',
        account_id: profile.id,
        credentials: { accessToken: token.access_token },
      });
    }

    await clearPendingLinkedInConnect();
    return { profileName, refreshedChannels: existing.length, createdPersonal: !personal };
  });

export const startMetaConnect = createServerFn({ method: 'POST' })
  .inputValidator(StartMetaConnectInput)
  .handler(async ({ data }) => {
    const session = await requireAuth();
    getMetaConnectConfig();
    const state = randomState();
    await session.update({
      ...session.data,
      metaConnect: {
        state,
        origin: data.origin,
      } satisfies MetaConnectDraft,
    });
    return { url: buildMetaAuthorizeUrl(data.origin, state) };
  });

export const completeMetaConnect = createServerFn({ method: 'POST' })
  .inputValidator(CompleteMetaConnectInput)
  .handler(async ({ data }) => {
    await requireAuth();
    const draft = await readPendingMetaConnect();

    if (draft.state !== data.state) {
      await clearPendingMetaConnect();
      throw new Error('Meta connect state mismatch. Start again from Channels settings.');
    }

    const redirectUri = buildMetaCallbackUrl(draft.origin);
    const shortLived = await exchangeMetaCode(data.code, redirectUri);
    const longLived = await exchangeLongLivedMetaToken(shortLived.access_token).catch(() => shortLived);
    const userAccessToken = longLived.access_token || shortLived.access_token;
    const pages = await listMetaPages(userAccessToken);

    if (pages.length === 0) {
      await clearPendingMetaConnect();
      throw new Error('No Facebook Pages were returned for this account. Connect an account with page access and a linked Instagram business account if needed.');
    }

    const teamId = await requireTeamId();
    const existingFacebook = await listChannelsByPlatform(teamId, 'facebook');
    const existingInstagram = await listChannelsByPlatform(teamId, 'instagram');
    let nextFacebookDefault = existingFacebook.length === 0;
    let nextInstagramDefault = existingInstagram.length === 0;
    let facebookCount = 0;
    let instagramCount = 0;

    const { appId } = getMetaConnectConfig();

    for (const page of pages) {
      if (!page.access_token) continue;

      await persistChannel({
        name: page.name,
        platform: 'facebook',
        account_type: 'page',
        is_default: nextFacebookDefault,
        account_id: page.id,
        credentials: {
          appId,
          pageId: page.id,
          pageAccessToken: page.access_token,
          userAccessToken,
        },
      });
      facebookCount += 1;
      nextFacebookDefault = false;

      const instagramAccounts = new Map<string, { id: string; username?: string | null }>();
      for (const candidate of [page.instagram_business_account, page.connected_instagram_account]) {
        if (candidate?.id) {
          instagramAccounts.set(candidate.id, candidate);
        }
      }

      for (const ig of instagramAccounts.values()) {
        await persistChannel({
          name: ig.username?.trim() ? `@${ig.username.trim()}` : `${page.name} Instagram`,
          platform: 'instagram',
          account_type: 'company',
          is_default: nextInstagramDefault,
          account_id: ig.id,
          credentials: {
            accessToken: page.access_token,
            instagramUserId: ig.id,
          },
        });
        instagramCount += 1;
        nextInstagramDefault = false;
      }
    }

    await clearPendingMetaConnect();

    return { facebookCount, instagramCount };
  });

export const startYouTubeConnect = createServerFn({ method: 'POST' })
  .inputValidator(StartYouTubeConnectInput)
  .handler(async ({ data }) => {
    const session = await requireAuth();
    getYouTubeConnectConfig();
    const state = randomState();
    await session.update({
      ...session.data,
      youtubeConnect: {
        state,
        origin: data.origin,
        name: data.name.trim(),
        account_type: data.account_type,
        privacyStatus: data.privacyStatus,
        notifySubscribers: data.notifySubscribers,
      } satisfies YouTubeConnectDraft,
    });
    return { url: buildYouTubeAuthorizeUrl(data.origin, state) };
  });

export const completeYouTubeConnect = createServerFn({ method: 'POST' })
  .inputValidator(CompleteYouTubeConnectInput)
  .handler(async ({ data }) => {
    await requireAuth();
    const draft = await readPendingYouTubeConnect();

    if (draft.state !== data.state) {
      await clearPendingYouTubeConnect();
      throw new Error('YouTube connect state mismatch. Start again from Channels settings.');
    }

    const redirectUri = buildYouTubeCallbackUrl(draft.origin);
    const { clientId, clientSecret } = getYouTubeConnectConfig();
    const tokens = await exchangeYouTubeCode(data.code, redirectUri);
    const channel = await fetchYouTubeChannel(tokens.access_token);
    const existing = await listChannelsByPlatform(await requireTeamId(), 'youtube');

    await persistChannel({
      name: draft.name || channel.title,
      platform: 'youtube',
      account_type: draft.account_type,
      is_default: existing.length === 0,
      account_id: channel.id,
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        clientId,
        clientSecret,
        privacyStatus: draft.privacyStatus,
        notifySubscribers: draft.notifySubscribers,
      },
    });

    await clearPendingYouTubeConnect();

    return { channelName: draft.name || channel.title };
  });
