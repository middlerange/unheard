// ABOUTME: Facebook Page publishing client for text and video posts.
// ABOUTME: Uses the Resumable Upload API to obtain a file handle, then publishes the video to the Page.

import type { Media } from './db/types';

const FACEBOOK_API_VERSION = 'v25.0';
const FACEBOOK_GRAPH_BASE = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;
const FACEBOOK_VIDEO_BASE = `https://graph-video.facebook.com/${FACEBOOK_API_VERSION}`;

export interface FacebookCreds {
  appId: string;
  pageId: string;
  pageAccessToken: string;
  userAccessToken?: string;
}

function deriveFacebookTitle(content: string, media: Media): string {
  const firstLine = content
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 100) ?? media.filename.replace(/\.[^.]+$/, '').slice(0, 100);
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `Facebook API ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function facebookPublishText(message: string, creds: FacebookCreds): Promise<string> {
  if (!message.trim()) throw new Error('Facebook text posts need a message');
  if ([...message].length > 63206) throw new Error('Facebook text posts exceed the 63206 character limit');
  const form = new FormData();
  form.set('access_token', creds.pageAccessToken);
  form.set('message', message);
  form.set('published', 'true');
  const published = await fetchJson<{ id?: string }>(
    `${FACEBOOK_GRAPH_BASE}/${encodeURIComponent(creds.pageId)}/feed`,
    { method: 'POST', body: form },
  );
  if (!published.id) throw new Error('Facebook did not return a published post id');
  return published.id;
}

export async function facebookPublishVideo(
  description: string,
  media: Media[],
  creds: FacebookCreds,
): Promise<string> {
  const video = media.find(item => item.type === 'video');
  if (!video) {
    throw new Error('Facebook publishing currently requires one uploaded video');
  }

  const uploadToken = creds.userAccessToken ?? creds.pageAccessToken;

  const fileResponse = await fetch(video.url);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download video for Facebook upload: ${fileResponse.status}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);
  const mimeType = 'video/mp4';

  const startSessionUrl = new URL(`${FACEBOOK_GRAPH_BASE}/${creds.appId}/uploads`);
  startSessionUrl.searchParams.set('file_name', video.filename);
  startSessionUrl.searchParams.set('file_length', String(fileBytes.byteLength));
  startSessionUrl.searchParams.set('file_type', mimeType);
  startSessionUrl.searchParams.set('access_token', uploadToken);

  const uploadSession = await fetchJson<{ id: string }>(startSessionUrl, { method: 'POST' });
  const uploadId = uploadSession.id;
  if (!uploadId) {
    throw new Error('Facebook upload session did not return an upload id');
  }

  const uploadResult = await fetchJson<{ h: string }>(
    `${FACEBOOK_GRAPH_BASE}/${uploadId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${uploadToken}`,
        file_offset: '0',
        'Content-Type': mimeType,
      },
      body: fileBytes,
    },
  );

  if (!uploadResult.h) {
    throw new Error('Facebook upload did not return a file handle');
  }

  const form = new FormData();
  form.set('access_token', creds.pageAccessToken);
  form.set('title', deriveFacebookTitle(description, video));
  form.set('description', description);
  form.set('fbuploader_video_file_chunk', uploadResult.h);

  const published = await fetchJson<{ id: string }>(
    `${FACEBOOK_VIDEO_BASE}/${creds.pageId}/videos`,
    {
      method: 'POST',
      body: form,
    },
  );

  return published.id;
}
