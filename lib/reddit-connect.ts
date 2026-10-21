// ABOUTME: Reddit OAuth helpers for channel connection, callback URLs, and payload mapping.
// ABOUTME: Keeps provider-specific connection logic small, shared, and testable.

export const REDDIT_CONNECT_SCOPES = ['identity', 'read', 'submit', 'flair'] as const;

export type RedditConnectDraft = {
  state: string;
  origin: string;
  defaultSubreddit: string;
};

export type RedditConnectResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  username: string;
};

export function normalizeSubreddit(value: string): string {
  return value.trim().replace(/^\/?r\//i, '');
}

export function getRedditConnectConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Reddit OAuth is not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in the server environment.');
  }
  return { clientId, clientSecret };
}

export function isRedditConnectConfigured(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

export function buildRedditCallbackUrl(origin: string): string {
  return new URL('/reddit/callback', origin).toString();
}

export function buildRedditAuthorizeUrl(origin: string, state: string): string {
  const { clientId } = getRedditConnectConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: buildRedditCallbackUrl(origin),
    duration: 'permanent',
    scope: REDDIT_CONNECT_SCOPES.join(' '),
  });
  return `https://www.reddit.com/api/v1/authorize?${params.toString()}`;
}

export function buildRedditConnectRedirectUrl({ username, error }: { username?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (error) {
    params.set('reddit_error', error);
  } else {
    params.set('reddit_connected', '1');
    if (username) params.set('reddit_username', username);
  }
  return `/settings/channels?${params.toString()}`;
}

export function buildRedditChannelInput(
  draft: RedditConnectDraft,
  result: RedditConnectResult,
  existingChannelCount: number,
) {
  return {
    name: `u/${result.username}`,
    platform: 'reddit' as const,
    account_type: 'personal' as const,
    is_default: existingChannelCount === 0,
    group_name: 'company',
    account_id: result.username,
    credentials: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
      defaultSubreddit: normalizeSubreddit(draft.defaultSubreddit),
    },
  };
}
