// ABOUTME: Web-standard OAuth 2.1 handlers for the hosted Unheard MCP server.
// ABOUTME: Implements discovery, DCR, PKCE authorization, refresh rotation, and consent.

import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import {
  canonicalMcpResource,
  isAllowedRedirectUri,
  isAllowedResource,
  normalizeScope,
  pkceChallenge,
  publicBaseUrl,
  safeLocalRedirect,
  SUPPORTED_SCOPES,
} from './oauth';
import {
  approveAuthorizationRequest,
  consumeAuthorizationCode,
  createAuthorizationRequest,
  denyAuthorizationRequest,
  getAuthorizationCode,
  getAuthorizationRequest,
  getOAuthClient,
  issueTokenGrant,
  registerOAuthClient,
  revokeOAuthToken,
  rotateRefreshToken,
} from './oauth-store';

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

function oauthError(status: number, error: string, description: string) {
  return json({ error, error_description: description }, status);
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function redirectWithError(redirectUri: string, state: string | null, error: string, description: string) {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  return redirect(target.toString());
}

export function protectedResourceMetadata(request: Request) {
  const base = publicBaseUrl(request);
  return json({
    resource: canonicalMcpResource(base),
    resource_name: 'Unheard MCP server',
    authorization_servers: [base],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/settings/api-keys`,
  });
}

export function authorizationServerMetadata(request: Request) {
  const base = publicBaseUrl(request);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SUPPORTED_SCOPES,
  });
}

export async function registerClient(request: Request) {
  const input = await body(request).catch(() => null);
  if (!input) return oauthError(400, 'invalid_client_metadata', 'Request body must be valid JSON');
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (redirectUris.length === 0 || !redirectUris.every(isAllowedRedirectUri)) {
    return oauthError(400, 'invalid_redirect_uri', 'redirect_uris must contain HTTPS or loopback HTTP URLs');
  }

  const client = await registerOAuthClient({
    name: typeof input.client_name === 'string' && input.client_name.trim() ? input.client_name.trim().slice(0, 160) : 'MCP client',
    redirectUris,
    clientUri: typeof input.client_uri === 'string' ? input.client_uri : null,
    logoUri: typeof input.logo_uri === 'string' ? input.logo_uri : null,
  });
  return json({
    client_id: client.id,
    client_id_issued_at: Math.floor(client.created_at / 1000),
    client_name: client.name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, 201);
}

export async function authorize(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const client = await getOAuthClient(clientId);
  if (!client) return oauthError(400, 'invalid_request', 'Unknown client_id');

  let registeredUris: string[] = [];
  try {
    registeredUris = JSON.parse(client.redirect_uris);
  } catch {
    return oauthError(400, 'invalid_request', 'Client registration is invalid');
  }
  if (!registeredUris.includes(redirectUri)) {
    return oauthError(400, 'invalid_request', 'redirect_uri is not registered for this client');
  }

  const state = url.searchParams.get('state');
  if (url.searchParams.get('response_type') !== 'code') {
    return redirectWithError(redirectUri, state, 'unsupported_response_type', 'Only response_type=code is supported');
  }
  const codeChallenge = url.searchParams.get('code_challenge');
  if (!codeChallenge || url.searchParams.get('code_challenge_method') !== 'S256') {
    return redirectWithError(redirectUri, state, 'invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  const scope = normalizeScope(url.searchParams.get('scope'));
  if (!scope) {
    return redirectWithError(redirectUri, state, 'invalid_scope', `Supported scopes: ${SUPPORTED_SCOPES.join(', ')}`);
  }

  const base = publicBaseUrl(request);
  const resource = url.searchParams.get('resource');
  if (!isAllowedResource(resource, base)) {
    return redirectWithError(redirectUri, state, 'invalid_target', `resource must be ${canonicalMcpResource(base)}`);
  }

  const requestToken = await createAuthorizationRequest({
    clientId,
    scope,
    redirectUri,
    state,
    codeChallenge,
    resource: resource!,
  });
  return redirect(`${base}/oauth/consent?request=${encodeURIComponent(requestToken)}`);
}

export async function token(request: Request) {
  const input = await body(request).catch(() => null);
  if (!input) return oauthError(400, 'invalid_request', 'Request body is invalid');
  const base = publicBaseUrl(request);
  const resource = typeof input.resource === 'string' ? input.resource : null;
  if (!isAllowedResource(resource, base)) {
    return oauthError(400, 'invalid_target', `resource must be ${canonicalMcpResource(base)}`);
  }

  if (input.grant_type === 'authorization_code') {
    const rawCode = typeof input.code === 'string' ? input.code : '';
    const verifier = typeof input.code_verifier === 'string' ? input.code_verifier : '';
    const clientId = typeof input.client_id === 'string' ? input.client_id : '';
    if (!rawCode || !verifier || !clientId) {
      return oauthError(400, 'invalid_request', 'code, code_verifier and client_id are required');
    }

    const code = await getAuthorizationCode(rawCode);
    if (!code || code.client_id !== clientId) return oauthError(400, 'invalid_grant', 'Authorization code is invalid or expired');
    if (typeof input.redirect_uri === 'string' && input.redirect_uri !== code.redirect_uri) {
      return oauthError(400, 'invalid_grant', 'redirect_uri does not match');
    }
    if (resource !== code.resource) return oauthError(400, 'invalid_target', 'resource does not match the authorization grant');
    if (await pkceChallenge(verifier) !== code.code_challenge) {
      return oauthError(400, 'invalid_grant', 'PKCE verification failed');
    }
    if (!(await consumeAuthorizationCode(code.id))) {
      return oauthError(400, 'invalid_grant', 'Authorization code is invalid or expired');
    }

    return json(await issueTokenGrant({
      clientId: code.client_id,
      userId: code.user_id,
      teamId: code.team_id,
      scope: code.scope,
      resource: code.resource,
    }));
  }

  if (input.grant_type === 'refresh_token') {
    const rawToken = typeof input.refresh_token === 'string' ? input.refresh_token : '';
    if (!rawToken) return oauthError(400, 'invalid_request', 'refresh_token is required');
    const rotated = await rotateRefreshToken(rawToken, typeof input.client_id === 'string' ? input.client_id : null);
    return rotated ? json(rotated) : oauthError(400, 'invalid_grant', 'Refresh token is invalid or expired');
  }

  return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
}

export async function revoke(request: Request) {
  const input: Record<string, unknown> = await body(request).catch(() => ({}));
  if (typeof input.token === 'string' && input.token) await revokeOAuthToken(input.token);
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function consentContext(rawRequest: string) {
  const grant = await getAuthorizationRequest(rawRequest);
  if (!grant) return null;
  const [client, db] = await Promise.all([getOAuthClient(grant.client_id), getDb()]);
  if (!client) return null;
  return { grant, client, db };
}

export async function consent(request: Request) {
  const url = new URL(request.url);
  const consentForm = request.method === 'POST' ? await request.formData() : null;
  const rawRequest = consentForm
    ? String(consentForm.get('request') || '')
    : url.searchParams.get('request') || '';
  if (!rawRequest) return oauthError(400, 'invalid_request', 'Missing authorization request');

  const session = await getSession();
  if (!session.data.userId || !session.data.teamId) {
    const returnTo = safeLocalRedirect(`/oauth/consent?request=${encodeURIComponent(rawRequest)}`);
    return redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  }

  const context = await consentContext(rawRequest);
  if (!context) return oauthError(400, 'invalid_request', 'Authorization request is invalid or expired');
  const membership = await context.db
    .select({ id: schema.team_memberships.id })
    .from(schema.team_memberships)
    .where(and(
      eq(schema.team_memberships.user_id, session.data.userId),
      eq(schema.team_memberships.team_id, session.data.teamId),
    ))
    .limit(1);
  if (membership.length === 0) return oauthError(403, 'access_denied', 'You do not have access to this workspace');

  if (request.method === 'POST') {
    const decision = consentForm?.get('decision');
    if (decision === 'deny') {
      const denied = await denyAuthorizationRequest(rawRequest);
      if (!denied) return oauthError(400, 'invalid_request', 'Authorization request is invalid or expired');
      return redirectWithError(denied.redirect_uri, denied.state, 'access_denied', 'The user denied access');
    }
    if (decision !== 'approve' && decision !== 'approve_read') {
      return oauthError(400, 'invalid_request', 'Choose an access level or deny the request');
    }

    const approvedScope = decision === 'approve_read' ? 'read' : undefined;
    const approved = await approveAuthorizationRequest(rawRequest, session.data.userId, session.data.teamId, approvedScope);
    if (!approved) return oauthError(400, 'invalid_request', 'Authorization request is invalid or expired');
    const target = new URL(approved.request.redirect_uri);
    target.searchParams.set('code', approved.code);
    if (approved.request.state) target.searchParams.set('state', approved.request.state);
    return redirect(target.toString());
  }

  const team = (await context.db
    .select({ name: schema.teams.name })
    .from(schema.teams)
    .where(eq(schema.teams.id, session.data.teamId))
    .limit(1))[0];
  const scopes = context.grant.scope.split(' ');
  const scopeItems = scopes.map(scope => `<li>${scope === 'write' ? 'Create, update, schedule, and send Unheard content for approval' : 'View the Unheard content workspace and calendar'}</li>`).join('');
  const approveButtons = scopes.includes('write')
    ? '<button class="approve" name="decision" value="approve_read">Connect read-only</button><button name="decision" value="approve">Allow edits</button>'
    : '<button class="approve" name="decision" value="approve_read">Connect read-only</button>';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize ${escapeHtml(context.client.name)}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;display:grid;min-height:100vh;place-items:center}.card{width:min(440px,calc(100vw - 32px));background:white;border:1px solid #e2e8f0;border-radius:14px;padding:28px;box-shadow:0 12px 36px rgba(15,23,42,.08)}h1{font-size:22px;margin:0 0 8px}p,li{font-size:14px;line-height:1.55;color:#475569}ul{padding-left:20px}.workspace{background:#f1f5f9;border-radius:8px;padding:10px 12px;margin:18px 0}.actions{display:flex;gap:10px;margin-top:24px}button{border:1px solid #cbd5e1;border-radius:8px;padding:10px 16px;font-weight:600;background:white;cursor:pointer}.approve{background:#0f172a;color:white;border-color:#0f172a;flex:1}</style></head>
<body><main class="card"><h1>Connect ${escapeHtml(context.client.name)}</h1><p>This app is requesting access to the Unheard MCP server.</p><div class="workspace"><strong>${escapeHtml(team?.name || 'Current workspace')}</strong></div><ul>${scopeItems}</ul><form method="post" class="actions"><input type="hidden" name="request" value="${escapeHtml(rawRequest)}"><button name="decision" value="deny">Cancel</button>${approveButtons}</form></main></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
    },
  });
}
