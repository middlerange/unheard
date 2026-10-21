// ABOUTME: OAuth dynamic client registration endpoint for MCP clients.
// ABOUTME: Registers public PKCE clients with exact redirect URI matching.

import { createFileRoute } from '@tanstack/react-router';
import { registerClient } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/oauth/register')({
  server: { handlers: { POST: ({ request }) => registerClient(request) } },
});
