// ABOUTME: Tests Reddit submission validation and automatic OAuth token refresh.
// ABOUTME: Verifies the production request shape without contacting Reddit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redditPost, validateRedditPostInput } from './reddit';

describe('validateRedditPostInput', () => {
  it('requires link posts to include a URL', () => {
    expect(() => validateRedditPostInput({
      subreddit: 'Userorbit',
      title: 'New article',
      content: '',
      postType: 'link',
    })).toThrow('require a URL');
  });

  it('accepts a valid text post', () => {
    expect(() => validateRedditPostInput({
      subreddit: 'Userorbit',
      title: 'What we shipped',
      content: 'A useful update.',
      postType: 'self',
    })).not.toThrow();
  });
});

describe('redditPost', () => {
  beforeEach(() => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'client-id');
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('REDDIT_USER_AGENT', 'web:test:1.0 (by /u/test)');
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('refreshes an expired access token before submitting', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'fresh-access',
        expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        json: { data: { name: 't3_abc', url: 'https://www.reddit.com/r/Userorbit/comments/abc/update/' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await redditPost({
      subreddit: 'Userorbit',
      title: 'New article',
      content: '',
      url: 'https://userorbit.com/blog/new-article',
      postType: 'link',
      flairId: 'product-update',
      nsfw: false,
      spoiler: true,
    }, {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
      expiresAt: 9_000,
    });

    expect(result).toBe('https://www.reddit.com/r/Userorbit/comments/abc/update/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.reddit.com/api/v1/access_token');
    expect(fetchMock.mock.calls[1][0]).toBe('https://oauth.reddit.com/api/submit');

    const submit = fetchMock.mock.calls[1][1]!;
    expect(submit.headers).toMatchObject({ Authorization: 'Bearer fresh-access' });
    const body = new URLSearchParams(String(submit.body));
    expect(body.get('sr')).toBe('Userorbit');
    expect(body.get('kind')).toBe('link');
    expect(body.get('url')).toBe('https://userorbit.com/blog/new-article');
    expect(body.get('flair_id')).toBe('product-update');
    expect(body.get('nsfw')).toBeNull();
    expect(body.get('spoiler')).toBe('true');
  });
});
