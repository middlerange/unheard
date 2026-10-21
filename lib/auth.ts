// ABOUTME: Authentication helpers — session config, password hashing, and middleware.
// ABOUTME: Uses TanStack Start encrypted cookie sessions and Node.js crypto.scrypt.

import { createMiddleware } from '@tanstack/react-start';
import type { SessionConfig } from '@tanstack/start-server-core';
import type { AuthSession } from './db/types';

export type { AuthSession };

export async function getSession() {
  const { useSession } = await import('@tanstack/react-start/server');
  return useSession<AuthSession>(getSessionConfig());
}

export function getSessionConfig(): SessionConfig {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error('Set SESSION_SECRET to a unique secret of at least 32 characters before starting Content Hub.');
  }
  return {
    password,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    },
  };
}

export async function hashPassword(plain: string): Promise<string> {
  const { scrypt, randomBytes } = await import('crypto');
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    scrypt(plain, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const { scrypt, timingSafeEqual } = await import('crypto');
  return new Promise((resolve, reject) => {
    const [salt, hashed] = hash.split(':');
    scrypt(plain, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(Buffer.from(hashed, 'hex'), key));
    });
  });
}

export const authMiddleware = createMiddleware().server(async ({ next }) => {
  const session = await getSession();
  if (!session.data.userId) {
    throw new Error('Unauthorized');
  }
  return next();
});

export type AgentIdentity = {
  teamId: string;
  userId: string | null;
  scopes: Array<'read' | 'write'>;
  tokenType: 'api_key' | 'oauth' | 'session';
};

export async function getBearerAgentIdentity(request: Request): Promise<AgentIdentity | Response> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

  if (token) {
    if (token.startsWith('uh_at_')) {
      const { findValidAccessToken } = await import('./mcp/oauth-store');
      const grant = await findValidAccessToken(token);
      if (!grant) return Response.json({ error: 'Invalid or expired OAuth token' }, { status: 401 });
      return {
        teamId: grant.team_id,
        userId: grant.user_id,
        scopes: grant.scopes,
        tokenType: 'oauth',
      };
    }

    const [{ hashApiKey }, { getApiKeyByHash, touchApiKey }] = await Promise.all([
      import('./api-keys'),
      import('./db/queries'),
    ]);
    const apiKey = await getApiKeyByHash(hashApiKey(token));
    if (!apiKey) return Response.json({ error: 'Invalid API key' }, { status: 401 });
    if (apiKey.revoked_at) return Response.json({ error: 'API key revoked' }, { status: 401 });
    await touchApiKey(apiKey.id, Date.now());
    return {
      teamId: apiKey.team_id,
      userId: apiKey.created_by,
      scopes: ['read', 'write'],
      tokenType: 'api_key',
    };
  }

  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function getRequestAgentIdentity(request: Request): Promise<AgentIdentity | Response> {
  if (request.headers.get('authorization')) return getBearerAgentIdentity(request);

  const session = await getSession();
  if (session.data.teamId) {
    return {
      teamId: session.data.teamId,
      userId: session.data.userId ?? null,
      scopes: ['read', 'write'],
      tokenType: 'session',
    };
  }

  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function getRequestTeamId(request: Request): Promise<string | Response> {
  const identity = await getRequestAgentIdentity(request);
  if (identity instanceof Response) return identity;
  if (identity.tokenType === 'oauth') {
    return Response.json({ error: 'OAuth tokens are only accepted by the agent and MCP endpoints' }, { status: 401 });
  }
  return identity.teamId;
}

export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
