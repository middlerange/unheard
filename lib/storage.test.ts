import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveMedia, uploadFile } from './storage';

afterEach(() => {
  globalThis.__contentHubMediaBucket__ = undefined;
  globalThis.__contentHubOrigin__ = undefined;
  vi.unstubAllEnvs();
});

const filename = '12345678-1234-1234-1234-123456789012.mp4';

describe('native media storage', () => {
  it('uploads through the R2 binding and produces a URL on this deployment', async () => {
    const put = vi.fn();
    globalThis.__contentHubMediaBucket__ = { put, get: vi.fn() };
    globalThis.__contentHubOrigin__ = 'https://my-hub.workers.dev';
    vi.stubEnv('CONTENT_HUB_PUBLIC_URL', '');
    const bytes = Buffer.from('video');
    expect(await uploadFile(`media/${filename}`, bytes, 'video/mp4')).toBe(`https://my-hub.workers.dev/media/${filename}`);
    expect(put).toHaveBeenCalledWith(`media/${filename}`, bytes, { httpMetadata: { contentType: 'video/mp4' } });
  });

  it('serves provider-accessible media without authentication and supports HEAD', async () => {
    const get = vi.fn().mockImplementation(async () => ({
      body: new Blob(['video']).stream(), size: 5, httpEtag: '"etag"', httpMetadata: { contentType: 'video/mp4' },
    }));
    globalThis.__contentHubMediaBucket__ = { put: vi.fn(), get };
    const response = await serveMedia(new Request('https://hub.test/media/file'), filename);
    expect(await response.text()).toBe('video');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    const head = await serveMedia(new Request('https://hub.test/media/file', { method: 'HEAD' }), filename);
    expect(await head.text()).toBe('');
    expect(head.headers.get('content-length')).toBe('5');
  });

  it('rejects paths outside the upload namespace without reading storage', async () => {
    const get = vi.fn();
    globalThis.__contentHubMediaBucket__ = { put: vi.fn(), get };
    expect((await serveMedia(new Request('https://hub.test'), '../private')).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing object', async () => {
    globalThis.__contentHubMediaBucket__ = { put: vi.fn(), get: vi.fn().mockResolvedValue(null) };
    expect((await serveMedia(new Request('https://hub.test'), filename)).status).toBe(404);
  });
});
