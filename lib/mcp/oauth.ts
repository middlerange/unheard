// ABOUTME: OAuth 2.1 primitives shared by the Unheard MCP server's authorization routes.
// ABOUTME: Keeps redirect, scope, resource, token, and PKCE validation consistent.

export const ACCESS_TOKEN_PREFIX = 'uh_at_';
export const REFRESH_TOKEN_PREFIX = 'uh_rt_';
export const AUTHORIZATION_REQUEST_PREFIX = 'uh_ar_';
export const AUTHORIZATION_CODE_PREFIX = 'uh_ac_';
export const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
export const SUPPORTED_SCOPES = ['read', 'write'] as const;

export function publicBaseUrl(request: Request) {
  const configured = process.env.CONTENT_HUB_PUBLIC_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, '');
}

export function canonicalMcpResource(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`;
}

export function isAllowedResource(resource: string | null | undefined, baseUrl: string) {
  return resource === canonicalMcpResource(baseUrl);
}

export function isAllowedRedirectUri(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return url.protocol === 'http:' && loopback;
  } catch {
    return false;
  }
}

export function normalizeScope(value: unknown) {
  const requested = [...new Set(String(value || 'read').split(/\s+/).filter(Boolean))];
  if (requested.length === 0) return 'read';
  if (requested.some(scope => !SUPPORTED_SCOPES.includes(scope as (typeof SUPPORTED_SCOPES)[number]))) return null;
  if (!requested.includes('read')) requested.unshift('read');
  return requested.join(' ');
}

export function parseScopes(value: string | null | undefined): Array<'read' | 'write'> {
  const normalized = normalizeScope(value);
  return (normalized || 'read').split(' ') as Array<'read' | 'write'>;
}

export function generateToken(prefix: string) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}${encoded}`;
}

export async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function pkceChallenge(verifier: string) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function safeLocalRedirect(value: unknown, fallback = '/calendar') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
