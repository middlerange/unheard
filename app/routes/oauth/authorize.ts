// ABOUTME: OAuth authorization endpoint for MCP client connections.
// ABOUTME: Validates the public client and PKCE request before opening consent.

import { createFileRoute } from '@tanstack/react-router';
import { authorize } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/oauth/authorize')({
  server: { handlers: { GET: ({ request }) => authorize(request) } },
});
