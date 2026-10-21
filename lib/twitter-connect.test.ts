// ABOUTME: Tests for Twitter OAuth connection helpers.
// ABOUTME: Covers callback URL generation, redirect state, and channel payload mapping.

import { describe, it, expect } from 'vitest';
import {
  buildTwitterCallbackUrl,
  buildTwitterChannelInput,
  buildTwitterConnectRedirectUrl,
} from './twitter-connect';

describe('buildTwitterCallbackUrl', () => {
  it('appends the callback path to the current origin', () => {
    expect(buildTwitterCallbackUrl('http://localhost:3003')).toBe('http://localhost:3003/twitter/callback');
    expect(buildTwitterCallbackUrl('https://content-hub.app/')).toBe('https://content-hub.app/twitter/callback');
  });
});

describe('buildTwitterChannelInput', () => {
  it('maps the oauth result into a twitter channel payload', () => {
    expect(buildTwitterChannelInput({
      name: 'Company X',
      account_type: 'company',
      apiKey: 'app-key',
      apiSecret: 'app-secret',
      premium: true,
      requestToken: 'request-token',
      requestTokenSecret: 'request-secret',
    }, {
      accessToken: 'access-token',
      accessSecret: 'access-secret',
      screenName: 'company',
    }, 0)).toEqual({
      name: 'Company X',
      platform: 'twitter',
      account_type: 'company',
      is_default: true,
      credentials: {
        apiKey: 'app-key',
        apiSecret: 'app-secret',
        accessToken: 'access-token',
        accessTokenSecret: 'access-secret',
        premium: true,
      },
    });
  });

  it('does not mark the channel as default when one already exists', () => {
    expect(buildTwitterChannelInput({
      name: '',
      account_type: 'personal',
      apiKey: 'app-key',
      apiSecret: 'app-secret',
      premium: false,
      requestToken: 'request-token',
      requestTokenSecret: 'request-secret',
    }, {
      accessToken: 'access-token',
      accessSecret: 'access-secret',
      screenName: 'founder',
    }, 2)).toMatchObject({
      name: 'founder',
      is_default: false,
    });
  });
});

describe('buildTwitterConnectRedirectUrl', () => {
  it('encodes callback errors for the settings page', () => {
    expect(buildTwitterConnectRedirectUrl('Access denied')).toBe('/settings/channels?twitter_error=Access+denied');
    expect(buildTwitterConnectRedirectUrl()).toBe('/settings/channels?twitter_connected=1');
  });
});
