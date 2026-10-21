// ABOUTME: YouTube upload client using the YouTube Data API resumable upload flow.
// ABOUTME: Publishes a single uploaded video with snippet/status metadata.

import type { Media } from './db/types';

const YOUTUBE_UPLOAD_INIT_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface YouTubeCreds {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  notifySubscribers?: boolean;
}

function deriveYouTubeTitle(content: string, media: Media): string {
  const firstLine = content
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return (firstLine ?? media.filename.replace(/\.[^.]+$/, '')).slice(0, 100) || 'Published with Unheard';
}

async function getYouTubeAccessToken(creds: YouTubeCreds): Promise<string> {
  if (creds.refreshToken && creds.clientId && creds.clientSecret) {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || typeof payload.access_token !== 'string') {
      const message = typeof payload?.error_description === 'string'
        ? payload.error_description
        : 'Failed to refresh YouTube access token';
      throw new Error(message);
    }

    return payload.access_token;
  }

  if (!creds.accessToken) {
    throw new Error('YouTube publishing requires an access token or refresh token credentials');
  }

  return creds.accessToken;
}

export async function youtubeUploadVideo(
  description: string,
  media: Media[],
  creds: YouTubeCreds,
): Promise<string> {
  const video = media.find(item => item.type === 'video');
  if (!video) {
    throw new Error('YouTube publishing requires one uploaded video');
  }

  const accessToken = await getYouTubeAccessToken(creds);
  const download = await fetch(video.url);
  if (!download.ok) {
    throw new Error(`Failed to download video for YouTube upload: ${download.status}`);
  }

  const fileBuffer = await download.arrayBuffer();
  const metadata = {
    snippet: {
      title: deriveYouTubeTitle(description, video),
      description: description.slice(0, 5000),
    },
    status: {
      privacyStatus: creds.privacyStatus ?? 'private',
    },
  };

  const initUrl = new URL(YOUTUBE_UPLOAD_INIT_URL);
  initUrl.searchParams.set('uploadType', 'resumable');
  initUrl.searchParams.set('part', 'snippet,status');
  initUrl.searchParams.set('notifySubscribers', String(creds.notifySubscribers ?? false));

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileBuffer.byteLength),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) {
    const text = await initResponse.text();
    throw new Error(`YouTube upload init failed: ${text}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube upload session did not return a resumable upload URL');
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileBuffer.byteLength),
      'Content-Type': 'video/mp4',
    },
    body: fileBuffer,
  });

  const payload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || typeof payload.id !== 'string') {
    throw new Error(`YouTube upload failed: ${JSON.stringify(payload)}`);
  }

  return payload.id;
}
