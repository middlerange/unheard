// ABOUTME: Hosted Streamable HTTP endpoint for the Unheard MCP server.
// ABOUTME: Authenticates team API keys or OAuth access tokens and proxies safe tool calls to the agent API.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createFileRoute } from '@tanstack/react-router';
import { getBearerAgentIdentity } from '@/lib/auth';
import { canonicalMcpResource, publicBaseUrl } from '@/lib/mcp/oauth';
import { buildMcpServer, type AgentInvocation } from '@/lib/mcp/protocol';

function authChallenge(request: Request, message = 'A valid Unheard MCP access token is required') {
  const metadata = `${publicBaseUrl(request)}/.well-known/oauth-protected-resource/mcp`;
  return Response.json(
    { error: 'unauthorized', error_description: message },
    {
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'www-authenticate': `Bearer resource_metadata="${metadata}"`,
      },
    },
  );
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set([
    new URL(publicBaseUrl(request)).origin,
    ...(process.env.MCP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  ]);
  return allowed.has(origin);
}

function sanitizeAgentResult(invocation: AgentInvocation, result: unknown) {
  if (invocation.resource !== 'channels' && invocation.resource !== 'webhooks') return result;

  const sanitizeRecord = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = { ...value as Record<string, unknown> };
    if (invocation.resource === 'channels') delete record.credentials;
    if (invocation.resource === 'webhooks') {
      delete record.secret;
      delete record.headers;
    }
    return record;
  };

  return Array.isArray(result) ? result.map(sanitizeRecord) : sanitizeRecord(result);
}

async function callAgentApi(request: Request, invocation?: AgentInvocation) {
  const response = await fetch(new URL('/api/agent', request.url), {
    method: invocation ? 'POST' : 'GET',
    headers: {
      authorization: request.headers.get('authorization') || '',
      ...(invocation ? { 'content-type': 'application/json' } : {}),
    },
    body: invocation ? JSON.stringify(invocation) : undefined,
  });
  const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error || `Unheard API returned ${response.status}`);
  return invocation ? sanitizeAgentResult(invocation, payload.result) : payload;
}

async function handleMcp(request: Request) {
  if (!isAllowedOrigin(request)) return Response.json({ error: 'Origin not allowed' }, { status: 403 });

  const identity = await getBearerAgentIdentity(request);
  if (identity instanceof Response) return authChallenge(request);

  const server = buildMcpServer({
    scopes: identity.scopes,
    capabilities: () => callAgentApi(request),
    invoke: invocation => callAgentApi(request, invocation),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, {
      authInfo: {
        token: request.headers.get('authorization')!.slice('Bearer '.length),
        clientId: identity.tokenType,
        scopes: identity.scopes,
        extra: {
          teamId: identity.teamId,
          userId: identity.userId,
          resource: canonicalMcpResource(publicBaseUrl(request)),
        },
      },
    });
  } finally {
    await transport.close();
    await server.close();
  }
}

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => handleMcp(request),
      GET: ({ request }) => handleMcp(request),
      DELETE: ({ request }) => handleMcp(request),
      OPTIONS: () => new Response(null, {
        status: 204,
        headers: {
          allow: 'GET, POST, DELETE, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        },
      }),
    },
  },
});
