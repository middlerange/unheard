// ABOUTME: Reddit OAuth callback route for exchanging authorization codes into refreshable credentials.
// ABOUTME: Connects the Reddit user and returns to Channels settings with a visible status.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { completeRedditConnect } from '@/app/server-fns/reddit-connect';
import { buildRedditConnectRedirectUrl } from '@/lib/reddit-connect';

export const Route = createFileRoute('/reddit/callback')({
  beforeLoad: async ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const error = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (error) {
      throw redirect({ href: buildRedditConnectRedirectUrl({ error }) });
    }
    if (!code || !state) {
      throw redirect({ href: buildRedditConnectRedirectUrl({ error: 'Reddit callback is missing required parameters.' }) });
    }

    let href: string;
    try {
      const result = await completeRedditConnect({ data: { code, state } });
      href = buildRedditConnectRedirectUrl({ username: result.username });
    } catch (callbackError) {
      const message = callbackError instanceof Error ? callbackError.message : 'Reddit connect failed.';
      href = buildRedditConnectRedirectUrl({ error: message });
    }
    throw redirect({ href });
  },
  component: () => null,
});
