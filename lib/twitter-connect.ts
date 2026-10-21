// ABOUTME: Twitter connection helpers for OAuth callback URLs and channel payload creation.
// ABOUTME: Keeps connect-flow mapping logic small, shared, and testable.

export type TwitterConnectDraft = {
  name: string;
  account_type: 'personal' | 'company' | 'page';
  apiKey: string;
  apiSecret: string;
  premium: boolean;
  requestToken: string;
  requestTokenSecret: string;
};

export type TwitterConnectResult = {
  accessToken: string;
  accessSecret: string;
  screenName: string;
};

export function buildTwitterCallbackUrl(origin: string): string {
  return new URL('/twitter/callback', origin).toString();
}

export function buildTwitterConnectRedirectUrl(error?: string): string {
  const params = new URLSearchParams();
  if (error) {
    params.set('twitter_error', error);
  } else {
    params.set('twitter_connected', '1');
  }
  return `/settings/channels?${params.toString()}`;
}

export function buildTwitterChannelInput(draft: TwitterConnectDraft, result: TwitterConnectResult, existingChannelCount: number) {
  return {
    name: draft.name.trim() || result.screenName,
    platform: 'twitter' as const,
    account_type: draft.account_type,
    is_default: existingChannelCount === 0,
    credentials: {
      apiKey: draft.apiKey,
      apiSecret: draft.apiSecret,
      accessToken: result.accessToken,
      accessTokenSecret: result.accessSecret,
      premium: draft.premium,
    },
  };
}
