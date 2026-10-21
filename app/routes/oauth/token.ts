// ABOUTME: OAuth token endpoint for MCP clients.
// ABOUTME: Exchanges PKCE authorization codes and rotates refresh tokens.

import { createFileRoute } from '@tanstack/react-router';
import { token } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/oauth/token')({
  server: { handlers: { POST: ({ request }) => token(request) } },
});
