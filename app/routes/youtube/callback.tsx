// ABOUTME: YouTube OAuth callback route for exchanging the Google code into upload credentials.
// ABOUTME: Creates or refreshes the connected YouTube channel and redirects back to settings.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { completeYouTubeConnect } from '@/app/server-fns/social-connect';
import { buildYouTubeConnectRedirectUrl } from '@/lib/social-connect';

export const Route = createFileRoute('/youtube/callback')({
  beforeLoad: async ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const code = params.get('code');
    const state = params.get('state');
    const errorReason = params.get('error_description') ?? params.get('error');

    if (errorReason) {
      throw redirect({ href: buildYouTubeConnectRedirectUrl({ error: errorReason }) });
    }

    if (!code || !state) {
      throw redirect({ href: buildYouTubeConnectRedirectUrl({ error: 'YouTube callback is missing the authorization code or state.' }) });
    }

    let href: string;
    try {
      const result = await completeYouTubeConnect({ data: { code, state } });
      href = buildYouTubeConnectRedirectUrl({ channelName: result.channelName });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YouTube connect failed.';
      href = buildYouTubeConnectRedirectUrl({ error: message });
    }

    throw redirect({ href });
  },
  component: () => null,
});
