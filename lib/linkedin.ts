// ABOUTME: LinkedIn API wrapper for posting content (text, images, multi-image).
// ABOUTME: Uses the Community Management Posts API (rest/posts) with Images API for uploads.

import type { Media } from './db/types';

const REST = 'https://api.linkedin.com/rest';
const PROFILE = 'https://api.linkedin.com/v2/me';
const VERSION = '202603';

export interface LinkedInCreds {
  accessToken: string;
  orgId?: string;
  personId?: string;
}

export function withLinkedInAccountId(
  creds: LinkedInCreds,
  accountId: string | null | undefined,
  accountType: 'personal' | 'company' | 'page',
): LinkedInCreds {
  if (!accountId) return creds;
  if (accountType === 'personal') return { ...creds, personId: accountId };
  return creds;
}

function token(creds?: LinkedInCreds) {
  const t = creds?.accessToken ?? process.env.LINKEDIN_ACCESS_TOKEN;
  if (!t) throw new Error('LINKEDIN_ACCESS_TOKEN not set in .env.local');
  return t;
}

function headers(creds?: LinkedInCreds): Record<string, string> {
  return {
    Authorization: `Bearer ${token(creds)}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': VERSION,
  };
}

async function getProfile(creds?: LinkedInCreds): Promise<{ id: string }> {
  const res = await fetchWithStage('profile', () =>
    fetch(PROFILE, { headers: { Authorization: `Bearer ${token(creds)}` } }),
  );
  if (!res.ok) throw new Error(`[LinkedIn profile] status ${res.status}`);
  const data = await res.json();
  const id = data.id ?? data.sub?.replace('urn:li:person:', '');
  return { id };
}

async function initializeImageUpload(owner: string, creds?: LinkedInCreds): Promise<{ uploadUrl: string; imageUrn: string }> {
  const res = await fetch(`${REST}/images?action=initializeUpload`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn image upload init failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return {
    uploadUrl: data.value.uploadUrl,
    imageUrn: data.value.image,
  };
}

async function uploadImage(uploadUrl: string, imageUrl: string, creds?: LinkedInCreds): Promise<void> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Failed to fetch image for LinkedIn upload: ${imageRes.status}`);
  const buffer = await imageRes.arrayBuffer();
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token(creds)}`, 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  if (!res.ok) throw new Error(`LinkedIn image upload failed: ${res.status}`);
}

interface VideoUploadInstruction {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
}

async function initializeVideoUpload(
  owner: string,
  fileSizeBytes: number,
  creds?: LinkedInCreds,
): Promise<{ videoUrn: string; uploadToken: string; instructions: VideoUploadInstruction[] }> {
  const res = await fetch(`${REST}/videos?action=initializeUpload`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn video upload init failed (${res.status}): ${err}`);
  }
  const data = await res.json() as {
    value: {
      video: string;
      uploadToken: string;
      uploadInstructions: VideoUploadInstruction[];
    };
  };
  return {
    videoUrn: data.value.video,
    uploadToken: data.value.uploadToken,
    instructions: data.value.uploadInstructions,
  };
}

async function fetchWithStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const cause = err instanceof Error ? (err.cause ? ` (cause: ${String(err.cause)})` : '') : '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[LinkedIn ${stage}] ${msg}${cause}`);
  }
}

async function retry(stage: string, maxAttempts: number, fn: () => Promise<Response>): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const backoff = 500 * 2 ** (attempt - 1);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const cause = lastErr instanceof Error && lastErr.cause ? ` (cause: ${String(lastErr.cause)})` : '';
  throw new Error(`[LinkedIn ${stage}] ${msg}${cause} after ${maxAttempts} attempts`);
}

async function uploadVideo(videoUrl: string, owner: string, creds?: LinkedInCreds): Promise<string> {
  const videoRes = await fetchWithStage('fetch-r2', () => fetch(videoUrl));
  if (!videoRes.ok) throw new Error(`[LinkedIn fetch-r2] status ${videoRes.status}`);
  const buffer = await fetchWithStage('fetch-r2-body', () => videoRes.arrayBuffer());
  const fileSizeBytes = buffer.byteLength;

  const { videoUrn, uploadToken, instructions } = await fetchWithStage(
    'init',
    () => initializeVideoUpload(owner, fileSizeBytes, creds),
  );

  const uploadedPartIds: string[] = [];
  for (let i = 0; i < instructions.length; i += 1) {
    const instruction = instructions[i];
    const part = buffer.slice(instruction.firstByte, instruction.lastByte + 1);
    const label = `upload-part-${i + 1}/${instructions.length}`;
    const putRes = await retry(label, 4, () =>
      fetch(instruction.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token(creds)}`,
          'Content-Type': 'application/octet-stream',
        },
        body: part,
      }),
    );
    if (!putRes.ok) {
      const err = await putRes.text();
      throw new Error(`[LinkedIn ${label}] status ${putRes.status}: ${err}`);
    }
    const etag = putRes.headers.get('etag');
    if (!etag) throw new Error(`[LinkedIn ${label}] missing ETag header`);
    uploadedPartIds.push(etag.replace(/"/g, ''));
  }

  const finalizeRes = await fetchWithStage('finalize', () =>
    fetch(`${REST}/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: headers(creds),
      body: JSON.stringify({
        finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds },
      }),
    }),
  );
  if (!finalizeRes.ok) {
    const err = await finalizeRes.text();
    throw new Error(`[LinkedIn finalize] status ${finalizeRes.status}: ${err}`);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetchWithStage('processing', () =>
      fetch(`${REST}/videos/${encodeURIComponent(videoUrn)}`, { headers: headers(creds) }),
    );
    if (!response.ok) throw new Error(`[LinkedIn processing] status ${response.status}`);
    const video = await response.json() as { status?: string };
    if (video.status === 'AVAILABLE') return videoUrn;
    if (video.status === 'PROCESSING_FAILED') throw new Error('LinkedIn video processing failed');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('LinkedIn video did not finish processing in time');
}

export async function linkedinPost(
  content: string,
  media: Media[],
  asCarousel = false,
  carouselName?: string,
  creds?: LinkedInCreds,
): Promise<string> {
  let author: string;

  if (creds?.orgId) {
    author = `urn:li:organization:${creds.orgId}`;
  } else if (creds?.personId) {
    author = `urn:li:person:${creds.personId.replace(/^urn:li:person:/, '')}`;
  } else {
    const profile = await getProfile(creds);
    author = `urn:li:person:${profile.id}`;
  }

  const images = media.filter(m => m.type === 'image');
  const videos = media.filter(m => m.type === 'video');
  const imageUrns: string[] = [];

  if (images.length > 0) {
    for (const img of images) {
      const { uploadUrl, imageUrn } = await initializeImageUpload(author, creds);
      await uploadImage(uploadUrl, img.url, creds);
      imageUrns.push(imageUrn);
    }
  }

  let videoUrn: string | null = null;
  if (videos.length > 0) {
    videoUrn = await uploadVideo(videos[0].url, author, creds);
  }

  let contentField: object | undefined;
  if (videoUrn) {
    contentField = { media: { id: videoUrn, title: carouselName ?? '' } };
  } else if (imageUrns.length === 1) {
    contentField = { media: { id: imageUrns[0], altText: carouselName ?? '' } };
  } else if (imageUrns.length > 1) {
    contentField = {
      multiImage: {
        images: imageUrns.map((urn, i) => ({
          id: urn,
          altText: carouselName ? `${carouselName} ${i + 1}` : '',
        })),
      },
    };
  }

  const body = {
    author,
    commentary: content,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
    ...(contentField ? { content: contentField } : {}),
  };

  const res = await fetchWithStage('post', () =>
    fetch(`${REST}/posts`, {
      method: 'POST',
      headers: headers(creds),
      body: JSON.stringify(body),
    }),
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[LinkedIn post] status ${res.status}: ${err}`);
  }

  const id = res.headers.get('x-restli-id') ?? '';
  return id;
}

export async function commentOnPost(content: string, postUrn: string, creds?: LinkedInCreds): Promise<string> {
  const res = await fetch(`${REST}/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ object: postUrn, message: { text: content } }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn comment failed (${res.status}): ${err}`);
  }

  const id = res.headers.get('x-restli-id') ?? '';
  return id;
}

export const MAX_CHARACTERS = 3000;
