// ABOUTME: OAuth token revocation endpoint for MCP clients.
// ABOUTME: Revokes either access or refresh tokens without leaking token validity.

import { createFileRoute } from '@tanstack/react-router';
import { revoke } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/oauth/revoke')({
  server: { handlers: { POST: ({ request }) => revoke(request) } },
});
