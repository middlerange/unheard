// ABOUTME: LinkedIn OAuth callback route for refreshing company access and linking the founder profile.
// ABOUTME: Exchanges the authorization code server-side, then returns to Channels settings.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { completeLinkedInConnect } from '@/app/server-fns/social-connect';
import { buildLinkedInConnectRedirectUrl } from '@/lib/social-connect';

export const Route = createFileRoute('/linkedin/callback')({
  beforeLoad: async ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const error = params.get('error_description') || params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (error) {
      throw redirect({ href: buildLinkedInConnectRedirectUrl({ error }) });
    }
    if (!code || !state) {
      throw redirect({ href: buildLinkedInConnectRedirectUrl({ error: 'LinkedIn callback is missing required parameters.' }) });
    }

    let href: string;
    try {
      const result = await completeLinkedInConnect({ data: { code, state } });
      href = buildLinkedInConnectRedirectUrl({ profileName: result.profileName });
    } catch (callbackError) {
      const message = callbackError instanceof Error ? callbackError.message : 'LinkedIn connect failed.';
      href = buildLinkedInConnectRedirectUrl({ error: message });
    }
    throw redirect({ href });
  },
  component: () => null,
});
