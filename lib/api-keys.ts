// ABOUTME: API key generation and hashing helpers for self-serve agent access.
// ABOUTME: Raw keys are shown once; only SHA-256 hashes are stored.

import { createHash, randomBytes } from 'crypto';

const PREFIX = 'uo_live';

export function generateApiKey(): string {
  return `${PREFIX}_${randomBytes(32).toString('base64url')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function getApiKeyPrefix(key: string): string {
  const [prefix, env, token] = key.split('_');
  return `${prefix}_${env}_${token?.slice(0, 8) ?? ''}`;
}
