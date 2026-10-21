// ABOUTME: Instagram publishing client for professional accounts.
// ABOUTME: Publishes a single image post or video reel using the Instagram Platform API.

import type { Media } from './db/types';

const INSTAGRAM_API_VERSION = 'v25.0';
const INSTAGRAM_API_BASE = `https://graph.facebook.com/${INSTAGRAM_API_VERSION}`;

export interface InstagramCreds {
  accessToken: string;
  instagramUserId: string;
}

async function instagramRequest<T>(
  path: string,
  accessToken: string,
  init?: RequestInit & { searchParams?: Record<string, string> },
): Promise<T> {
  const url = new URL(`${INSTAGRAM_API_BASE}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(init?.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Instagram API ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

async function waitForContainer(accessToken: string, containerId: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const payload = await instagramRequest<{ status_code?: string; status?: string }>(
      containerId,
      accessToken,
      {
        method: 'GET',
        searchParams: { fields: 'status_code,status' },
      },
    );

    const status = payload.status_code ?? payload.status;
    if (status === 'FINISHED' || status === 'PUBLISHED') {
      return;
    }

    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram media container failed with status ${status}`);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Instagram media container did not finish processing in time');
}

export async function instagramPublish(
  caption: string,
  media: Media[],
  creds: InstagramCreds,
): Promise<string> {
  const primaryMedia = media[0];
  if (!primaryMedia) {
    throw new Error('Instagram publishing requires one uploaded image or video');
  }

  const isVideo = primaryMedia.type === 'video';
  const requestBody = isVideo
    ? {
        caption,
        media_type: 'REELS',
        video_url: primaryMedia.url,
        share_to_feed: true,
      }
    : {
        caption,
        image_url: primaryMedia.url,
      };

  const container = await instagramRequest<{ id: string }>(
    `${creds.instagramUserId}/media`,
    creds.accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
  );

  if (isVideo) {
    await waitForContainer(creds.accessToken, container.id);
  }

  const published = await instagramRequest<{ id: string }>(
    `${creds.instagramUserId}/media_publish`,
    creds.accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: container.id }),
    },
  );

  return published.id;
}
