// ABOUTME: OAuth protected-resource discovery for the hosted MCP endpoint.
// ABOUTME: Publishes authorization-server and scope metadata per RFC 9728.

import { createFileRoute } from '@tanstack/react-router';
import { protectedResourceMetadata } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: { handlers: { GET: ({ request }) => protectedResourceMetadata(request) } },
});
