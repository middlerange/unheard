// ABOUTME: Tests the security-sensitive pure helpers used by the MCP OAuth flow.
// ABOUTME: Covers exact resources, safe redirects, scopes, hashing, and PKCE.

import { describe, expect, it } from 'vitest';
import {
  canonicalMcpResource,
  hashToken,
  isAllowedRedirectUri,
  isAllowedResource,
  normalizeScope,
  pkceChallenge,
  safeLocalRedirect,
} from './oauth';
import { protectedResourceMetadata } from './oauth-server';

describe('MCP OAuth helpers', () => {
  it('binds tokens to the exact MCP resource', () => {
    expect(canonicalMcpResource('https://unheard.io/')).toBe('https://unheard.io/mcp');
    expect(isAllowedResource('https://unheard.io/mcp', 'https://unheard.io')).toBe(true);
    expect(isAllowedResource('https://evil.example/mcp', 'https://unheard.io')).toBe(false);
  });

  it('advertises the Unheard MCP server name', async () => {
    const response = protectedResourceMetadata(new Request('https://unheard.io/.well-known/oauth-protected-resource/mcp'));
    await expect(response.json()).resolves.toMatchObject({
      resource: 'https://unheard.io/mcp',
      resource_name: 'Unheard MCP server',
    });
  });

  it('allows HTTPS and loopback callbacks only', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:31337/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://example.com/callback')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
  });

  it('defaults to read and rejects unknown scopes', () => {
    expect(normalizeScope(undefined)).toBe('read');
    expect(normalizeScope('write')).toBe('read write');
    expect(normalizeScope('read write read')).toBe('read write');
    expect(normalizeScope('read admin')).toBeNull();
  });

  it('only accepts local post-login redirects', () => {
    expect(safeLocalRedirect('/oauth/consent?request=abc')).toBe('/oauth/consent?request=abc');
    expect(safeLocalRedirect('https://evil.example')).toBe('/calendar');
    expect(safeLocalRedirect('//evil.example')).toBe('/calendar');
  });

  it('uses SHA-256 for token storage and PKCE S256', async () => {
    await expect(hashToken('secret')).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
