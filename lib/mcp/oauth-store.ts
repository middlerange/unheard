// ABOUTME: D1 persistence for MCP OAuth clients, authorization grants, and tokens.
// ABOUTME: Stores only SHA-256 token hashes and rotates refresh grants on use.

import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/schema';
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_REQUEST_PREFIX,
  AUTHORIZATION_TTL_MS,
  generateToken,
  hashToken,
  parseScopes,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
} from './oauth';

export type OAuthGrant = {
  clientId: string;
  userId: string;
  teamId: string;
  scope: string;
  resource: string;
};

export async function registerOAuthClient(input: {
  name: string;
  redirectUris: string[];
  clientUri?: string | null;
  logoUri?: string | null;
}) {
  const db = await getDb();
  const row = {
    id: crypto.randomUUID(),
    name: input.name,
    redirect_uris: JSON.stringify(input.redirectUris),
    client_uri: input.clientUri ?? null,
    logo_uri: input.logoUri ?? null,
    created_at: Date.now(),
  };
  await db.insert(schema.oauth_clients).values(row);
  return row;
}

export async function getOAuthClient(id: string) {
  const db = await getDb();
  return (await db.select().from(schema.oauth_clients).where(eq(schema.oauth_clients.id, id)).limit(1))[0] ?? null;
}

export async function createAuthorizationRequest(input: {
  clientId: string;
  scope: string;
  redirectUri: string;
  state?: string | null;
  codeChallenge: string;
  resource: string;
}) {
  const token = generateToken(AUTHORIZATION_REQUEST_PREFIX);
  const now = Date.now();
  const db = await getDb();
  await db.insert(schema.oauth_authorization_requests).values({
    id: crypto.randomUUID(),
    request_token_hash: await hashToken(token),
    client_id: input.clientId,
    scope: input.scope,
    redirect_uri: input.redirectUri,
    state: input.state ?? null,
    code_challenge: input.codeChallenge,
    resource: input.resource,
    expires_at: now + AUTHORIZATION_TTL_MS,
    consumed_at: null,
    created_at: now,
  });
  return token;
}

export async function getAuthorizationRequest(rawToken: string) {
  const db = await getDb();
  const row = (await db
    .select()
    .from(schema.oauth_authorization_requests)
    .where(eq(schema.oauth_authorization_requests.request_token_hash, await hashToken(rawToken)))
    .limit(1))[0] ?? null;
  if (!row || row.consumed_at || row.expires_at < Date.now()) return null;
  return row;
}

export async function approveAuthorizationRequest(rawToken: string, userId: string, teamId: string, approvedScope?: string) {
  const request = await getAuthorizationRequest(rawToken);
  if (!request) return null;

  const db = await getDb();
  const consumed = await db
    .update(schema.oauth_authorization_requests)
    .set({ consumed_at: Date.now() })
    .where(and(
      eq(schema.oauth_authorization_requests.id, request.id),
      isNull(schema.oauth_authorization_requests.consumed_at),
    ))
    .returning({ id: schema.oauth_authorization_requests.id });
  if (consumed.length === 0) return null;

  const code = generateToken(AUTHORIZATION_CODE_PREFIX);
  const now = Date.now();
  await db.insert(schema.oauth_authorization_codes).values({
    id: crypto.randomUUID(),
    code_hash: await hashToken(code),
    client_id: request.client_id,
    user_id: userId,
    team_id: teamId,
    scope: approvedScope ?? request.scope,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    resource: request.resource,
    expires_at: now + AUTHORIZATION_TTL_MS,
    consumed_at: null,
    created_at: now,
  });

  return { code, request };
}

export async function denyAuthorizationRequest(rawToken: string) {
  const request = await getAuthorizationRequest(rawToken);
  if (!request) return null;
  const db = await getDb();
  const consumed = await db
    .update(schema.oauth_authorization_requests)
    .set({ consumed_at: Date.now() })
    .where(and(
      eq(schema.oauth_authorization_requests.id, request.id),
      isNull(schema.oauth_authorization_requests.consumed_at),
    ))
    .returning({ id: schema.oauth_authorization_requests.id });
  return consumed.length > 0 ? request : null;
}

export async function getAuthorizationCode(rawCode: string) {
  const db = await getDb();
  const row = (await db
    .select()
    .from(schema.oauth_authorization_codes)
    .where(eq(schema.oauth_authorization_codes.code_hash, await hashToken(rawCode)))
    .limit(1))[0] ?? null;
  if (!row || row.consumed_at || row.expires_at < Date.now()) return null;
  return row;
}

export async function consumeAuthorizationCode(id: string) {
  const db = await getDb();
  const consumed = await db
    .update(schema.oauth_authorization_codes)
    .set({ consumed_at: Date.now() })
    .where(and(eq(schema.oauth_authorization_codes.id, id), isNull(schema.oauth_authorization_codes.consumed_at)))
    .returning({ id: schema.oauth_authorization_codes.id });
  return consumed.length > 0;
}

export async function issueTokenGrant(grant: OAuthGrant) {
  const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = generateToken(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  const db = await getDb();
  await db.insert(schema.oauth_tokens).values({
    id: crypto.randomUUID(),
    access_token_hash: await hashToken(accessToken),
    refresh_token_hash: await hashToken(refreshToken),
    client_id: grant.clientId,
    user_id: grant.userId,
    team_id: grant.teamId,
    scope: grant.scope,
    resource: grant.resource,
    access_expires_at: now + ACCESS_TOKEN_TTL_MS,
    refresh_expires_at: now + REFRESH_TOKEN_TTL_MS,
    last_used_at: null,
    revoked_at: null,
    created_at: now,
  });
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: grant.scope,
  };
}

export async function findValidAccessToken(rawToken: string) {
  const db = await getDb();
  const row = (await db
    .select()
    .from(schema.oauth_tokens)
    .where(eq(schema.oauth_tokens.access_token_hash, await hashToken(rawToken)))
    .limit(1))[0] ?? null;
  if (!row || row.revoked_at || row.access_expires_at < Date.now()) return null;
  await db.update(schema.oauth_tokens).set({ last_used_at: Date.now() }).where(eq(schema.oauth_tokens.id, row.id));
  return { ...row, scopes: parseScopes(row.scope) };
}

export async function rotateRefreshToken(rawToken: string, clientId?: string | null) {
  const db = await getDb();
  const row = (await db
    .select()
    .from(schema.oauth_tokens)
    .where(eq(schema.oauth_tokens.refresh_token_hash, await hashToken(rawToken)))
    .limit(1))[0] ?? null;
  if (!row || row.revoked_at || row.refresh_expires_at < Date.now()) return null;
  if (clientId && row.client_id !== clientId) return null;

  const revoked = await db
    .update(schema.oauth_tokens)
    .set({ revoked_at: Date.now() })
    .where(and(eq(schema.oauth_tokens.id, row.id), isNull(schema.oauth_tokens.revoked_at)))
    .returning({ id: schema.oauth_tokens.id });
  if (revoked.length === 0) return null;

  return issueTokenGrant({
    clientId: row.client_id,
    userId: row.user_id,
    teamId: row.team_id,
    scope: row.scope,
    resource: row.resource,
  });
}

export async function revokeOAuthToken(rawToken: string) {
  const tokenHash = await hashToken(rawToken);
  const db = await getDb();
  await db
    .update(schema.oauth_tokens)
    .set({ revoked_at: Date.now() })
    .where(or(
      eq(schema.oauth_tokens.access_token_hash, tokenHash),
      eq(schema.oauth_tokens.refresh_token_hash, tokenHash),
    ));
}
