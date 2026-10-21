// ABOUTME: Tests for shared OAuth helper URLs and redirect serialization.
// ABOUTME: Covers Meta and YouTube callback helpers used by the channel connect flows.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMetaCallbackUrl,
  buildMetaConnectRedirectUrl,
  buildYouTubeCallbackUrl,
  buildYouTubeConnectRedirectUrl,
  getMetaConnectConfig,
  getYouTubeConnectConfig,
} from './social-connect';

describe('callback urls', () => {
  it('builds the meta callback URL from the current origin', () => {
    expect(buildMetaCallbackUrl('http://localhost:3003')).toBe('http://localhost:3003/meta/callback');
  });

  it('builds the youtube callback URL from the current origin', () => {
    expect(buildYouTubeCallbackUrl('https://unheard.io/')).toBe('https://unheard.io/youtube/callback');
  });
});

describe('redirect urls', () => {
  it('serializes meta success state with summary counts', () => {
    expect(buildMetaConnectRedirectUrl({ facebookCount: 2, instagramCount: 1 })).toBe(
      '/settings/channels?meta_connected=1&meta_summary=2+Facebook+pages%2C+1+Instagram+account',
    );
  });

  it('serializes youtube callback states', () => {
    expect(buildYouTubeConnectRedirectUrl({ channelName: 'PMTube' })).toBe(
      '/settings/channels?youtube_connected=1&youtube_channel=PMTube',
    );
    expect(buildYouTubeConnectRedirectUrl({ error: 'Denied' })).toBe(
      '/settings/channels?youtube_error=Denied',
    );
  });
});

describe('env config readers', () => {
  const env = vi.stubEnv;

  beforeEach(() => {
    env('META_APP_ID', undefined);
    env('META_APP_SECRET', undefined);
    env('YOUTUBE_CLIENT_ID', undefined);
    env('YOUTUBE_CLIENT_SECRET', undefined);
  });

  it('reads meta connect config from server env', () => {
    env('META_APP_ID', 'meta-app');
    env('META_APP_SECRET', 'meta-secret');
    expect(getMetaConnectConfig()).toEqual({ appId: 'meta-app', appSecret: 'meta-secret' });
  });

  it('reads youtube connect config from server env', () => {
    env('YOUTUBE_CLIENT_ID', 'yt-client');
    env('YOUTUBE_CLIENT_SECRET', 'yt-secret');
    expect(getYouTubeConnectConfig()).toEqual({ clientId: 'yt-client', clientSecret: 'yt-secret' });
  });
});
