// ABOUTME: Shared OAuth connect helpers for provider callbacks, env-backed app credentials, and redirect state.
// ABOUTME: Keeps provider setup centralized so channels can be connected with one-click flows instead of manual tokens.

export const META_API_VERSION = 'v25.0';
export const META_CONNECT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
] as const;

export const YOUTUBE_CONNECT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

export const LINKEDIN_CONNECT_SCOPES = [
  'r_basicprofile',
  'w_member_social',
  'w_organization_social',
] as const;

export type MetaConnectDraft = {
  state: string;
  origin: string;
};

export type YouTubeConnectDraft = {
  state: string;
  origin: string;
  name: string;
  account_type: 'personal' | 'company' | 'page';
  privacyStatus: 'private' | 'unlisted' | 'public';
  notifySubscribers: boolean;
};

export type LinkedInConnectDraft = {
  state: string;
  origin: string;
};

type RedirectCounts = {
  facebookCount?: number;
  instagramCount?: number;
};

export function getMetaConnectConfig(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Meta OAuth is not configured. Set META_APP_ID and META_APP_SECRET in the server environment.');
  }
  return { appId, appSecret };
}

export function isMetaConnectConfigured(): boolean {
  return Boolean((process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID) && (process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET));
}

export function getYouTubeConnectConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in the server environment.');
  }
  return { clientId, clientSecret };
}

export function isYouTubeConnectConfigured(): boolean {
  return Boolean((process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID) && (process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET));
}

export function getLinkedInConnectConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in the server environment.');
  }
  return { clientId, clientSecret };
}

export function isLinkedInConnectConfigured(): boolean {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
}

export function buildMetaCallbackUrl(origin: string): string {
  return new URL('/meta/callback', origin).toString();
}

export function buildYouTubeCallbackUrl(origin: string): string {
  return new URL('/youtube/callback', origin).toString();
}

export function buildLinkedInCallbackUrl(origin: string): string {
  return new URL('/linkedin/callback', origin).toString();
}

export function buildMetaAuthorizeUrl(origin: string, state: string): string {
  const { appId } = getMetaConnectConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: buildMetaCallbackUrl(origin),
    state,
    response_type: 'code',
    scope: META_CONNECT_SCOPES.join(','),
  });
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export function buildYouTubeAuthorizeUrl(origin: string, state: string): string {
  const { clientId } = getYouTubeConnectConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildYouTubeCallbackUrl(origin),
    response_type: 'code',
    scope: YOUTUBE_CONNECT_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  params.set('state', state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildLinkedInAuthorizeUrl(origin: string, state: string): string {
  const { clientId } = getLinkedInConnectConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: buildLinkedInCallbackUrl(origin),
    state,
    scope: LINKEDIN_CONNECT_SCOPES.join(' '),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

function summarizeMetaConnections({ facebookCount = 0, instagramCount = 0 }: RedirectCounts): string {
  const parts: string[] = [];
  if (facebookCount > 0) {
    parts.push(`${facebookCount} Facebook ${facebookCount === 1 ? 'page' : 'pages'}`);
  }
  if (instagramCount > 0) {
    parts.push(`${instagramCount} Instagram ${instagramCount === 1 ? 'account' : 'accounts'}`);
  }
  return parts.join(', ');
}

export function buildMetaConnectRedirectUrl({ facebookCount = 0, instagramCount = 0, error }: RedirectCounts & { error?: string }) {
  const params = new URLSearchParams();
  if (error) {
    params.set('meta_error', error);
  } else {
    params.set('meta_connected', '1');
    params.set('meta_summary', summarizeMetaConnections({ facebookCount, instagramCount }) || 'Meta channels connected');
  }
  return `/settings/channels?${params.toString()}`;
}

export function buildYouTubeConnectRedirectUrl({ channelName, error }: { channelName?: string; error?: string }) {
  const params = new URLSearchParams();
  if (error) {
    params.set('youtube_error', error);
  } else {
    params.set('youtube_connected', '1');
    if (channelName) {
      params.set('youtube_channel', channelName);
    }
  }
  return `/settings/channels?${params.toString()}`;
}

export function buildLinkedInConnectRedirectUrl({ profileName, error }: { profileName?: string; error?: string }) {
  const params = new URLSearchParams();
  if (error) {
    params.set('linkedin_error', error);
  } else {
    params.set('linkedin_connected', '1');
    if (profileName) params.set('linkedin_profile', profileName);
  }
  return `/settings/channels?${params.toString()}`;
}
