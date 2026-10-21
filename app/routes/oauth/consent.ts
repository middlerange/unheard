// ABOUTME: Signed-in workspace consent screen for MCP OAuth grants.
// ABOUTME: Lets a member approve or deny the validated authorization request.

import { createFileRoute } from '@tanstack/react-router';
import { consent } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/oauth/consent')({
  server: {
    handlers: {
      GET: ({ request }) => consent(request),
      POST: ({ request }) => consent(request),
    },
  },
});
