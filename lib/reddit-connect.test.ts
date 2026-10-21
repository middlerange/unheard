// ABOUTME: Tests Reddit OAuth helper URLs, normalization, and channel payload mapping.
// ABOUTME: Covers the provider contract without making network requests.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRedditAuthorizeUrl,
  buildRedditCallbackUrl,
  buildRedditChannelInput,
  buildRedditConnectRedirectUrl,
  getRedditConnectConfig,
  normalizeSubreddit,
} from './reddit-connect';

describe('Reddit connect helpers', () => {
  beforeEach(() => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'reddit-client');
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'reddit-secret');
  });

  it('normalizes subreddit names', () => {
    expect(normalizeSubreddit(' r/Userorbit ')).toBe('Userorbit');
    expect(normalizeSubreddit('/r/Userorbit')).toBe('Userorbit');
  });

  it('builds a permanent OAuth authorization URL with minimal scopes', () => {
    const url = new URL(buildRedditAuthorizeUrl('https://unheard.io/', 'state-1'));
    expect(url.origin + url.pathname).toBe('https://www.reddit.com/api/v1/authorize');
    expect(url.searchParams.get('client_id')).toBe('reddit-client');
    expect(url.searchParams.get('redirect_uri')).toBe('https://unheard.io/reddit/callback');
    expect(url.searchParams.get('duration')).toBe('permanent');
    expect(url.searchParams.get('scope')).toBe('identity read submit flair');
  });

  it('maps OAuth results into an encrypted channel payload', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    expect(buildRedditChannelInput({
      state: 'state-1',
      origin: 'https://unheard.io',
      defaultSubreddit: 'r/Userorbit',
    }, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      username: 'Userorbit',
    }, 0)).toEqual({
      name: 'u/Userorbit',
      platform: 'reddit',
      account_type: 'personal',
      is_default: true,
      group_name: 'company',
      account_id: 'Userorbit',
      credentials: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: 3_601_000,
        defaultSubreddit: 'Userorbit',
      },
    });
  });

  it('builds callback and settings redirect URLs', () => {
    expect(buildRedditCallbackUrl('http://localhost:3003')).toBe('http://localhost:3003/reddit/callback');
    expect(buildRedditConnectRedirectUrl({ username: 'Userorbit' })).toBe(
      '/settings/channels?reddit_connected=1&reddit_username=Userorbit',
    );
    expect(buildRedditConnectRedirectUrl({ error: 'Denied' })).toBe(
      '/settings/channels?reddit_error=Denied',
    );
  });

  it('reads Reddit app credentials from server env', () => {
    expect(getRedditConnectConfig()).toEqual({
      clientId: 'reddit-client',
      clientSecret: 'reddit-secret',
    });
  });
});
