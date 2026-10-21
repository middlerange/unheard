// ABOUTME: Twitter OAuth callback route for exchanging request tokens into access credentials.
// ABOUTME: Redirects back to Channels settings with success or error state after server-side completion.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { completeTwitterConnect } from '@/app/server-fns/twitter-connect';
import { buildTwitterConnectRedirectUrl } from '@/lib/twitter-connect';

export const Route = createFileRoute('/twitter/callback')({
  beforeLoad: async ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const denied = params.get('denied');
    const oauthToken = params.get('oauth_token');
    const oauthVerifier = params.get('oauth_verifier');

    if (denied) {
      throw redirect({ href: buildTwitterConnectRedirectUrl('Twitter authorization was denied.') });
    }

    if (!oauthToken || !oauthVerifier) {
      throw redirect({ href: buildTwitterConnectRedirectUrl('Twitter callback is missing required tokens.') });
    }

    let href: string;
    try {
      await completeTwitterConnect({ data: { oauth_token: oauthToken, oauth_verifier: oauthVerifier } });
      href = buildTwitterConnectRedirectUrl();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Twitter connect failed.';
      href = buildTwitterConnectRedirectUrl(message);
    }

    throw redirect({ href });
  },
  component: () => null,
});
