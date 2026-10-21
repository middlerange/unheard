// ABOUTME: Path-specific OAuth protected-resource discovery for /mcp.
// ABOUTME: Mirrors the root RFC 9728 metadata for clients that discover by resource path.

import { createFileRoute } from '@tanstack/react-router';
import { protectedResourceMetadata } from '@/lib/mcp/oauth-server';

export const Route = createFileRoute('/.well-known/oauth-protected-resource/mcp')({
  server: { handlers: { GET: ({ request }) => protectedResourceMetadata(request) } },
});
