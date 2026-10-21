// ABOUTME: Twitter/X API wrapper for posting content.
// ABOUTME: Uses runtime-safe fetch + OAuth 1.0a (no Node https dependency).

import type { Media } from './db/types';

export interface TwitterCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  premium?: boolean;
}

const TWITTER_API_BASE = 'https://api.twitter.com';
const TWITTER_UPLOAD_BASE = 'https://upload.twitter.com';

interface ResolvedTwitterCreds extends TwitterCreds {
  premium: boolean;
}

type OAuthParam = [string, string];

function parseTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function isTwitterPremium(creds?: TwitterCreds): boolean {
  return creds?.premium ?? parseTruthyEnv(process.env.TWITTER_PREMIUM);
}

function getCreds(creds?: TwitterCreds): ResolvedTwitterCreds {
  const apiKey = creds?.apiKey ?? process.env.TWITTER_API_KEY;
  const apiSecret = creds?.apiSecret ?? process.env.TWITTER_API_SECRET;
  const accessToken = creds?.accessToken ?? process.env.TWITTER_ACCESS_TOKEN;
  const accessTokenSecret = creds?.accessTokenSecret ?? process.env.TWITTER_ACCESS_TOKEN_SECRET;
  const premium = isTwitterPremium(creds);
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    throw new Error('Twitter credentials not configured. Set TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET in .env.local');
  }
  return { apiKey, apiSecret, accessToken, accessTokenSecret, premium };
}

function percentEncode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function randomNonce(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return base64FromArrayBuffer(sig);
}

function normalizeParams(params: OAuthParam[]): string {
  const encoded = params.map(([k, v]) => [percentEncode(k), percentEncode(v)] as const);
  encoded.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return encoded.map(([k, v]) => `${k}=${v}`).join('&');
}

function collectQueryParams(url: URL): OAuthParam[] {
  const result: OAuthParam[] = [];
  url.searchParams.forEach((value, key) => result.push([key, value]));
  return result;
}

function buildBaseUrl(url: URL): string {
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const isDefaultPort = (protocol === 'https:' && (url.port === '' || url.port === '443')) || (protocol === 'http:' && (url.port === '' || url.port === '80'));
  const host = isDefaultPort ? hostname : `${hostname}:${url.port}`;
  return `${protocol}//${host}${url.pathname}`;
}

function toAuthHeader(oauthParams: OAuthParam[]): string {
  return `OAuth ${oauthParams
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ')}`;
}

async function signedFetch(
  method: 'POST' | 'GET',
  rawUrl: string,
  creds: ResolvedTwitterCreds,
  init: Omit<RequestInit, 'method' | 'headers'> & { headers?: HeadersInit } = {},
  signatureParams: OAuthParam[] = [],
): Promise<Response> {
  const url = new URL(rawUrl);
  const oauthParams: OAuthParam[] = [
    ['oauth_consumer_key', creds.apiKey],
    ['oauth_nonce', randomNonce()],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', `${Math.floor(Date.now() / 1000)}`],
    ['oauth_token', creds.accessToken],
    ['oauth_version', '1.0'],
  ];

  const signingParams = [...collectQueryParams(url), ...signatureParams, ...oauthParams];
  const baseString = `${method.toUpperCase()}&${percentEncode(buildBaseUrl(url))}&${percentEncode(normalizeParams(signingParams))}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);
  const authHeader = toAuthHeader([...oauthParams, ['oauth_signature', signature]]);

  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', authHeader);
  headers.set('Accept', 'application/json');
  return fetch(rawUrl, { ...init, method, headers });
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `${res.status}`;
  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ message?: string; detail?: string }>; title?: string; detail?: string };
    const detail = parsed.errors?.map(e => e.message ?? e.detail).filter(Boolean).join('; ') ?? parsed.detail ?? parsed.title;
    return detail ? `${res.status}: ${detail}` : `${res.status}: ${text}`;
  } catch {
    return `${res.status}: ${text}`;
  }
}

async function uploadMedia(creds: ResolvedTwitterCreds, mediaItem: Media): Promise<string> {
  const res = await fetch(mediaItem.url);
  if (!res.ok) throw new Error(`Failed to fetch media from R2: ${res.status}`);
  const buffer = await res.arrayBuffer();

  if (mediaItem.type === 'video') {
    return uploadVideoChunked(creds, buffer);
  }

  const form = new FormData();
  form.append('media', new Blob([buffer], { type: 'image/jpeg' }), 'upload.jpg');

  const uploadRes = await signedFetch(
    'POST',
    `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`,
    creds,
    { body: form },
  );
  if (!uploadRes.ok) throw new Error(`Twitter media upload failed (${await readError(uploadRes)})`);
  const data = await uploadRes.json() as { media_id_string?: string };
  if (!data.media_id_string) throw new Error('Twitter media upload failed: missing media_id_string');
  return data.media_id_string;
}

function encodeFormBody(params: OAuthParam[]): string {
  return params.map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join('&');
}

async function uploadVideoChunked(creds: ResolvedTwitterCreds, buffer: ArrayBuffer): Promise<string> {
  const totalBytes = buffer.byteLength;
  const uploadUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json`;

  const initParams: OAuthParam[] = [
    ['command', 'INIT'],
    ['total_bytes', String(totalBytes)],
    ['media_type', 'video/mp4'],
    ['media_category', creds.premium ? 'amplify_video' : 'tweet_video'],
  ];
  const initRes = await signedFetch(
    'POST',
    uploadUrl,
    creds,
    {
      body: encodeFormBody(initParams),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    initParams,
  );
  if (!initRes.ok) throw new Error(`Twitter video INIT failed (${await readError(initRes)})`);
  const initData = await initRes.json() as { media_id_string?: string };
  const mediaId = initData.media_id_string;
  if (!mediaId) throw new Error('Twitter video INIT failed: missing media_id_string');

  const CHUNK_SIZE = 1024 * 1024;
  const numChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
  for (let i = 0; i < numChunks; i += 1) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalBytes);
    const chunk = buffer.slice(start, end);

    const form = new FormData();
    form.append('media', new Blob([chunk], { type: 'application/octet-stream' }));

    const appendUrl = `${uploadUrl}?command=APPEND&media_id=${mediaId}&segment_index=${i}`;
    const appendRes = await signedFetch('POST', appendUrl, creds, { body: form });
    if (!appendRes.ok) {
      throw new Error(`Twitter video APPEND chunk ${i}/${numChunks} failed (${await readError(appendRes)})`);
    }
  }

  const finalizeParams: OAuthParam[] = [
    ['command', 'FINALIZE'],
    ['media_id', mediaId],
  ];
  const finalizeRes = await signedFetch(
    'POST',
    uploadUrl,
    creds,
    {
      body: encodeFormBody(finalizeParams),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    finalizeParams,
  );
  if (!finalizeRes.ok) throw new Error(`Twitter video FINALIZE failed (${await readError(finalizeRes)})`);
  const finalizeData = await finalizeRes.json() as {
    processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
  };

  if (finalizeData.processing_info && finalizeData.processing_info.state !== 'succeeded') {
    await waitForVideoProcessing(creds, mediaId, finalizeData.processing_info.check_after_secs ?? 2);
  }

  return mediaId;
}

async function waitForVideoProcessing(creds: ResolvedTwitterCreds, mediaId: string, initialWaitSecs: number): Promise<void> {
  const maxAttempts = 30;
  let wait = initialWaitSecs;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, wait * 1000));
    const statusUrl = `${TWITTER_UPLOAD_BASE}/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
    const res = await signedFetch('GET', statusUrl, creds);
    if (!res.ok) throw new Error(`Twitter video STATUS failed (${await readError(res)})`);
    const data = await res.json() as {
      processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } };
    };
    const info = data.processing_info;
    if (!info) return;
    if (info.state === 'succeeded') return;
    if (info.state === 'failed') {
      throw new Error(`Twitter video processing failed: ${info.error?.message ?? 'unknown error'}`);
    }
    wait = info.check_after_secs ?? wait;
  }
  throw new Error('Twitter video processing timed out');
}

export async function tweetPost(content: string, media: Media[], replySettings?: string, creds?: TwitterCreds): Promise<string> {
  const resolved = getCreds(creds);

  const mediaIds: [string, ...string[]] | undefined =
    media.length > 0
      ? (await Promise.all(media.slice(0, 4).map(m => uploadMedia(resolved, m)))) as [string, ...string[]]
      : undefined;

  const body = {
    text: content,
    ...(mediaIds ? { media: { media_ids: mediaIds } } : {}),
    ...(replySettings && replySettings !== 'everyone'
      ? { reply_settings: replySettings as 'mentionedUsers' | 'following' | 'subscribers' }
      : {}),
  };

  const tweetRes = await signedFetch(
    'POST',
    `${TWITTER_API_BASE}/2/tweets`,
    resolved,
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!tweetRes.ok) throw new Error(`Twitter post failed (${await readError(tweetRes)})`);
  const tweet = await tweetRes.json() as { data?: { id?: string } };
  if (!tweet.data?.id) throw new Error('Twitter post failed: missing tweet ID');

  return tweet.data.id;
}

export async function replyToTweet(content: string, inReplyToId: string, media: Media[], replySettings?: string, creds?: TwitterCreds): Promise<string> {
  const resolved = getCreds(creds);

  const mediaIds: [string, ...string[]] | undefined =
    media.length > 0
      ? (await Promise.all(media.slice(0, 4).map(m => uploadMedia(resolved, m)))) as [string, ...string[]]
      : undefined;

  const body = {
    text: content,
    reply: { in_reply_to_tweet_id: inReplyToId },
    ...(mediaIds ? { media: { media_ids: mediaIds } } : {}),
    ...(replySettings && replySettings !== 'everyone'
      ? { reply_settings: replySettings as 'mentionedUsers' | 'following' | 'subscribers' }
      : {}),
  };

  const tweetRes = await signedFetch(
    'POST',
    `${TWITTER_API_BASE}/2/tweets`,
    resolved,
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!tweetRes.ok) throw new Error(`Twitter reply failed (${await readError(tweetRes)})`);
  const tweet = await tweetRes.json() as { data?: { id?: string } };
  if (!tweet.data?.id) throw new Error('Twitter reply failed: missing tweet ID');

  return tweet.data.id;
}

export function maxCharacters(creds?: TwitterCreds): number {
  return isTwitterPremium(creds) ? 4000 : 280;
}
