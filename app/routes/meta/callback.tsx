// ABOUTME: Meta OAuth callback route for Facebook and Instagram channel connection.
// ABOUTME: Exchanges the authorization code server-side, persists channels, and redirects to settings with status.

import { createFileRoute, redirect } from '@tanstack/react-router';
import { completeMetaConnect } from '@/app/server-fns/social-connect';
import { buildMetaConnectRedirectUrl } from '@/lib/social-connect';

export const Route = createFileRoute('/meta/callback')({
  beforeLoad: async ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const code = params.get('code');
    const state = params.get('state');
    const errorReason = params.get('error_description') ?? params.get('error_message');

    if (errorReason) {
      throw redirect({ href: buildMetaConnectRedirectUrl({ error: errorReason }) });
    }

    if (!code || !state) {
      throw redirect({ href: buildMetaConnectRedirectUrl({ error: 'Meta callback is missing the authorization code or state.' }) });
    }

    let href: string;
    try {
      const result = await completeMetaConnect({ data: { code, state } });
      href = buildMetaConnectRedirectUrl({
        facebookCount: result.facebookCount,
        instagramCount: result.instagramCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta connect failed.';
      href = buildMetaConnectRedirectUrl({ error: message });
    }

    throw redirect({ href });
  },
  component: () => null,
});
