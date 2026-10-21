// ABOUTME: Tests for the Telegram notification module.
// ABOUTME: Covers message formatting, no-op behavior, and error handling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPublishedMessage, buildFailedMessage, sendNotification, notifyPublished, notifyFailed } from './telegram';
import type { PostWithDetails } from './db/types';

function makePost(overrides: Partial<PostWithDetails> = {}): PostWithDetails {
    return {
      id: 'post-1',
      team_id: 'team-1',
      state: 'published',
      channel_group: 'personal',
    idea_id: null,
    template_id: null,
    brand_id: null,
    writing_prompt: null,
    publish_at: Date.now(),
    created_at: Date.now(),
    updated_at: Date.now(),
    template_name: null,
    brand_name: null,
    idea_text: null,
    targets: [
      {
        id: 'target-1',
        post_id: 'post-1',
        channel_id: null,
        platform: 'twitter',
        content: '<p>Hello world</p>',
        platform_post_id: '123456789',
        error: null,
        reply_settings: 'everyone',
        as_carousel: false,
        carousel_name: null,
        thread: null,
      },
    ],
    media: [],
    ...overrides,
  };
}

describe('buildPublishedMessage', () => {
  it('includes X link for twitter target', () => {
    const msg = buildPublishedMessage(makePost());
    expect(msg).toContain('X (Twitter)');
    expect(msg).toContain('https://x.com/i/status/123456789');
  });

  it('includes LinkedIn link for linkedin target', () => {
    const post = makePost({
      targets: [
        {
          id: 'target-2',
          post_id: 'post-1',
          channel_id: null,
          platform: 'linkedin',
          content: '<p>LinkedIn post</p>',
          platform_post_id: 'urn:li:share:999',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildPublishedMessage(post);
    expect(msg).toContain('LinkedIn');
    expect(msg).toContain('https://www.linkedin.com/feed/update/urn:li:share:999');
  });

  it('includes both links for multi-platform posts', () => {
    const post = makePost({
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: '<p>Dual post</p>',
          platform_post_id: '111',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
        {
          id: 'target-2',
          post_id: 'post-1',
          channel_id: null,
          platform: 'linkedin',
          content: '<p>Dual post</p>',
          platform_post_id: 'urn:li:share:222',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildPublishedMessage(post);
    expect(msg).toContain('https://x.com/i/status/111');
    expect(msg).toContain('https://www.linkedin.com/feed/update/urn:li:share:222');
  });

  it('skips targets without platform_post_id', () => {
    const post = makePost({
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: '<p>Failed post</p>',
          platform_post_id: null,
          error: 'some error',
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildPublishedMessage(post);
    expect(msg).not.toContain('https://x.com');
  });

  it('includes content preview stripped of HTML', () => {
    const msg = buildPublishedMessage(makePost());
    expect(msg).toContain('Hello world');
    expect(msg).not.toContain('<p>');
  });

  it('truncates preview to 300 characters', () => {
    const longContent = '<p>' + 'a'.repeat(500) + '</p>';
    const post = makePost({
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: longContent,
          platform_post_id: '999',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildPublishedMessage(post);
    const italicMatch = msg.match(/<i>(.*?)<\/i>/s);
    expect(italicMatch).toBeTruthy();
    expect(italicMatch![1].length).toBe(300);
  });

  it('escapes HTML entities in preview text', () => {
    const post = makePost({
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: '<p>AT&T growth update</p>',
          platform_post_id: '123',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildPublishedMessage(post);
    expect(msg).toContain('AT&amp;T growth update');
  });
});

describe('buildFailedMessage', () => {
  it('includes target errors for failed platforms', () => {
    const post = makePost({
      state: 'failed',
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: '<p>Dual post</p>',
          platform_post_id: null,
          error: 'Twitter API 500',
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
        {
          id: 'target-2',
          post_id: 'post-1',
          channel_id: null,
          platform: 'linkedin',
          content: '<p>Dual post</p>',
          platform_post_id: 'urn:li:share:222',
          error: null,
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildFailedMessage(post);
    expect(msg).toContain('Post publish failed');
    expect(msg).toContain('X (Twitter): ❌ Twitter API 500');
    expect(msg).toContain('LinkedIn: ✅ Published https://www.linkedin.com/feed/update/urn:li:share:222');
  });

  it('escapes HTML entities in errors', () => {
    const post = makePost({
      state: 'failed',
      targets: [
        {
          id: 'target-1',
          post_id: 'post-1',
          channel_id: null,
          platform: 'twitter',
          content: '<p>Failure sample</p>',
          platform_post_id: null,
          error: 'Bad <payload> & token',
          reply_settings: 'everyone',
          as_carousel: false,
          carousel_name: null,
          thread: null,
        },
      ],
    });
    const msg = buildFailedMessage(post);
    expect(msg).toContain('Bad &lt;payload&gt; &amp; token');
  });
});

describe('sendNotification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns false when env vars are not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const result = await sendNotification('test');
    expect(result).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls Telegram API with correct params', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const result = await sendNotification('hello');
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: '12345',
          text: 'hello',
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(sendNotification('hello')).rejects.toThrow('Telegram API 400');
  });
});

describe('notifyPublished', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('does not throw on API failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(notifyPublished(makePost())).resolves.toBeUndefined();
  });

  it('sends notification for published post', async () => {
    await notifyPublished(makePost());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('notifyFailed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('does not throw on API failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(notifyFailed(makePost({ state: 'failed' }))).resolves.toBeUndefined();
  });

  it('sends notification for failed post', async () => {
    await notifyFailed(makePost({ state: 'failed' }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
