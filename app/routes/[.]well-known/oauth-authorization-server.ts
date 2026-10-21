// ABOUTME: OAuth authorization-server discovery for MCP clients.
// ABOUTME: Advertises PKCE, dynamic registration, refresh, and revocation endpoints.

import { createFileRoute } from '@tanstack/react-router';
import { authorizationServerMetadata } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: { handlers: { GET: ({ request }) => authorizationServerMetadata(request) } },
});
