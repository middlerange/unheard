// ABOUTME: Reddit API wrapper for posting content to subreddits.
// ABOUTME: Uses OAuth 2.0 with refresh token flow for posting.

import type { Media } from './db/types';

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_BASE = 'https://www.reddit.com';

export interface RedditCreds {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface ResolvedRedditCreds extends RedditCreds {
  accessToken: string;
}

function redditUserAgent(): string {
  return process.env.REDDIT_USER_AGENT || 'web:unheard:1.0';
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Reddit access expired and OAuth refresh is not configured');
  }
  const response = await fetch(`${REDDIT_AUTH_BASE}/api/v1/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  const payload = await response.json().catch(() => null) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error || `Reddit token refresh failed (${response.status})`);
  }
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

export async function resolveRedditCreds(creds?: RedditCreds): Promise<ResolvedRedditCreds> {
  const accessToken = creds?.accessToken ?? process.env.REDDIT_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Reddit credentials not configured. Set REDDIT_ACCESS_TOKEN in .env.local');
  }
  const refreshToken = creds?.refreshToken ?? process.env.REDDIT_REFRESH_TOKEN;
  const expiresAt = creds?.expiresAt;
  if (refreshToken && expiresAt && expiresAt <= Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(refreshToken);
    return { ...refreshed, refreshToken };
  }
  return { accessToken, refreshToken, expiresAt };
}

function headers(creds: ResolvedRedditCreds): Record<string, string> {
  return {
    'Authorization': `Bearer ${creds.accessToken}`,
    'User-Agent': redditUserAgent(),
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export interface SubredditInfo {
  name: string;
  displayName: string;
  subscribers: number;
  over18: boolean;
  allowImages: boolean;
  allowVideos: boolean;
  allowText: boolean;
  allowLinks: boolean;
  flairEnabled: boolean;
  availableFlairs?: Array<{
    id: string;
    text: string;
    backgroundColor: string;
    textColor: string;
  }>;
}

/**
 * Search for subreddits by query
 */
export async function searchSubreddits(
  query: string,
  creds?: RedditCreds,
  limit = 10
): Promise<SubredditInfo[]> {
  const resolved = await resolveRedditCreds(creds);
  
  const res = await fetch(
    `${REDDIT_API_BASE}/subreddits/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: headers(resolved) }
  );
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit search failed (${res.status}): ${err}`);
  }
  
  const data = await res.json() as { data: { children: Array<{ data: { 
    display_name: string;
    display_name_prefixed: string;
    subscribers: number;
    over18: boolean;
    allow_images: boolean;
    allow_videos: boolean;
    allow_text: boolean;
    allow_links: boolean;
  } }> } };
  
  return data.data.children.map(child => ({
    name: child.data.display_name,
    displayName: child.data.display_name_prefixed,
    subscribers: child.data.subscribers,
    over18: child.data.over18,
    allowImages: child.data.allow_images,
    allowVideos: child.data.allow_videos,
    allowText: child.data.allow_text,
    allowLinks: child.data.allow_links,
    flairEnabled: false, // Will be fetched separately
  }));
}

/**
 * Get available flairs for a subreddit
 */
export async function getSubredditFlairs(
  subreddit: string,
  creds?: RedditCreds
): Promise<Array<{ id: string; text: string; backgroundColor: string; textColor: string }>> {
  const resolved = await resolveRedditCreds(creds);
  
  const res = await fetch(
    `${REDDIT_API_BASE}/r/${subreddit}/api/link_flair_v2`,
    { headers: headers(resolved) }
  );
  
  if (!res.ok) {
    // Not all subreddits have flairs, return empty array if 404
    if (res.status === 404) return [];
    const err = await res.text();
    throw new Error(`Reddit flair fetch failed (${res.status}): ${err}`);
  }
  
  const data = await res.json() as Array<{
    id: string;
    text: string;
    background_color: string;
    text_color: string;
  }>;
  
  return data.map(flair => ({
    id: flair.id,
    text: flair.text,
    backgroundColor: flair.background_color,
    textColor: flair.text_color,
  }));
}

/**
 * Upload media to Reddit (returns Reddit media URL)
 */
async function uploadMedia(
  mediaItem: Media,
  creds: ResolvedRedditCreds
): Promise<string> {
  // Fetch media from R2
  const res = await fetch(mediaItem.url);
  if (!res.ok) throw new Error(`Failed to fetch media: ${res.status}`);
  const buffer = await res.arrayBuffer();
  
  // Reddit uses direct image upload or URL-based posting
  // For now, we'll use the existing URL if it's publicly accessible
  // In production, you might need to upload to Reddit's hosting
  return mediaItem.url;
}

export interface RedditPostInput {
  subreddit: string;
  title: string;
  content: string;
  url?: string; // For link posts
  media?: Media[];
  flairId?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  sendReplies?: boolean;
  postType?: 'self' | 'link' | 'image' | 'video' | 'poll';
}

export function validateRedditPostInput(input: RedditPostInput): void {
  if (!/^[A-Za-z0-9_]{2,100}$/.test(input.subreddit)) {
    throw new Error('Reddit post requires a valid subreddit');
  }
  if (!input.title.trim()) {
    throw new Error('Reddit post requires a title');
  }
  if (input.title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Reddit title exceeds ${MAX_TITLE_LENGTH} characters`);
  }
  if (input.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Reddit content exceeds ${MAX_CONTENT_LENGTH} characters`);
  }
  if (input.postType === 'link' && !input.url) {
    throw new Error('Reddit link posts require a URL');
  }
}

/**
 * Post to a subreddit
 */
export async function redditPost(
  input: RedditPostInput,
  creds?: RedditCreds
): Promise<string> {
  validateRedditPostInput(input);
  const resolved = await resolveRedditCreds(creds);
  
  // Determine post type
  let postType = input.postType || 'self';
  if (input.url && !input.content && !input.media?.length) {
    postType = 'link';
  }
  if (input.media?.length && !input.url) {
    const firstMedia = input.media[0];
    if (firstMedia.type === 'video') postType = 'video';
    else if (firstMedia.type === 'image') postType = 'image';
  }
  
  // Build form data
  const params = new URLSearchParams();
  params.append('sr', input.subreddit);
  params.append('title', input.title);
  params.append('kind', postType);
  
  if (postType === 'self') {
    params.append('text', input.content);
  } else if (postType === 'link') {
    params.append('url', input.url || '');
  } else if (postType === 'image' || postType === 'video') {
    // For media posts, we need to upload the media first
    if (input.media?.length) {
      const mediaUrl = await uploadMedia(input.media[0], resolved);
      params.append('url', mediaUrl);
    }
  }
  
  // Optional parameters
  if (input.flairId) {
    params.append('flair_id', input.flairId);
  }
  if (input.nsfw) {
    params.append('nsfw', 'true');
  }
  if (input.spoiler) {
    params.append('spoiler', 'true');
  }
  if (input.sendReplies !== undefined) {
    params.append('sendreplies', input.sendReplies ? 'true' : 'false');
  }
  
  params.append('resubmit', 'false');
  params.append('api_type', 'json');
  
  const res = await fetch(`${REDDIT_API_BASE}/api/submit`, {
    method: 'POST',
    headers: headers(resolved),
    body: params.toString(),
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit post failed (${res.status}): ${err}`);
  }
  
  const data = await res.json() as { 
    json?: { 
      data?: { id?: string; name?: string; url?: string };
      errors?: Array<[string, string, string]>;
    } 
  };
  
  if (data.json?.errors && data.json.errors.length > 0) {
    const errorMessages = data.json.errors.map(e => e[1]).join('; ');
    throw new Error(`Reddit API error: ${errorMessages}`);
  }
  
  const postId = data.json?.data?.url || data.json?.data?.name || data.json?.data?.id;
  if (!postId) {
    throw new Error('Reddit post failed: no post ID returned');
  }
  
  return postId;
}

/**
 * Comment on a post
 */
export async function commentOnPost(
  postId: string,
  content: string,
  creds?: RedditCreds
): Promise<string> {
  const resolved = await resolveRedditCreds(creds);
  
  const params = new URLSearchParams();
  params.append('thing_id', postId);
  params.append('text', content);
  params.append('api_type', 'json');
  
  const res = await fetch(`${REDDIT_API_BASE}/api/comment`, {
    method: 'POST',
    headers: headers(resolved),
    body: params.toString(),
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit comment failed (${res.status}): ${err}`);
  }
  
  const data = await res.json() as {
    json?: {
      data?: { things?: Array<{ data?: { id?: string; name?: string } }> };
      errors?: Array<[string, string, string]>;
    };
  };
  
  if (data.json?.errors && data.json.errors.length > 0) {
    const errorMessages = data.json.errors.map(e => e[1]).join('; ');
    throw new Error(`Reddit API error: ${errorMessages}`);
  }
  
  const commentId = data.json?.data?.things?.[0]?.data?.name;
  if (!commentId) {
    throw new Error('Reddit comment failed: no comment ID returned');
  }
  
  return commentId;
}

/**
 * Get post details (for analytics)
 */
export async function getPostDetails(
  postId: string,
  creds?: RedditCreds
): Promise<{
  id: string;
  title: string;
  score: number;
  numComments: number;
  upvoteRatio: number;
  url: string;
}> {
  const resolved = await resolveRedditCreds(creds);
  
  const res = await fetch(
    `${REDDIT_API_BASE}/api/info?id=${postId}`,
    { headers: headers(resolved) }
  );
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reddit post fetch failed (${res.status}): ${err}`);
  }
  
  const data = await res.json() as {
    data: {
      children: Array<{
        data: {
          name: string;
          title: string;
          score: number;
          num_comments: number;
          upvote_ratio: number;
          url: string;
        };
      }>;
    };
  };
  
  const post = data.data.children[0]?.data;
  if (!post) {
    throw new Error('Post not found');
  }
  
  return {
    id: post.name,
    title: post.title,
    score: post.score,
    numComments: post.num_comments,
    upvoteRatio: post.upvote_ratio,
    url: post.url,
  };
}

export const MAX_TITLE_LENGTH = 300;
export const MAX_CONTENT_LENGTH = 40000;
