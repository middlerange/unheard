// ABOUTME: Media storage using a native Worker R2 binding, with legacy S3 support for local development.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface MediaObject {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

export interface MediaBucket {
  put(key: string, value: Buffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<MediaObject | null>;
}

declare global {
  var __contentHubMediaBucket__: MediaBucket | undefined;
  var __contentHubOrigin__: string | undefined;
}

export async function uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const bucket = globalThis.__contentHubMediaBucket__;
  if (bucket) {
    const origin = process.env.CONTENT_HUB_PUBLIC_URL || globalThis.__contentHubOrigin__;
    if (!origin) throw new Error('Media upload requires the deployment URL. Set CONTENT_HUB_PUBLIC_URL.');
    await bucket.put(key, buffer, { httpMetadata: { contentType } });
    return `${origin.replace(/\/$/, '')}/${key}`;
  }

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    throw new Error('Media storage is not configured. Bind MEDIA_BUCKET or configure the R2 environment variables.');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType,
  }));
  return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

export async function serveMedia(request: Request, filename: string): Promise<Response> {
  // Only UUID-named upload objects are public; bucket contents cannot be listed.
  if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i.test(filename)) return new Response('Not found', { status: 404 });
  const bucket = globalThis.__contentHubMediaBucket__;
  if (!bucket) return new Response('Media storage unavailable', { status: 503 });
  const object = await bucket.get(`media/${filename}`);
  if (!object) return new Response('Not found', { status: 404 });
  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Length': String(object.size),
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (!/^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime))$/i.test(contentType)) {
    headers.set('Content-Disposition', 'attachment');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
