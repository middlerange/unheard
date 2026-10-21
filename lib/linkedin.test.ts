import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkedinPost, withLinkedInAccountId } from './linkedin';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LinkedIn account identity', () => {
  it('uses the stored personal account ID without requesting OIDC userinfo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:123' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const id = await linkedinPost('Hello LinkedIn', [], false, undefined, {
      accessToken: 'token',
      personId: 'member-123',
    });

    expect(id).toBe('urn:li:share:123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linkedin.com/rest/posts',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      author: 'urn:li:person:member-123',
      commentary: 'Hello LinkedIn',
    });
  });

  it('maps stored channel IDs to the correct LinkedIn owner type', () => {
    expect(withLinkedInAccountId({ accessToken: 'token' }, 'member-123', 'personal')).toEqual({
      accessToken: 'token',
      personId: 'member-123',
    });
    expect(withLinkedInAccountId({ accessToken: 'token', orgId: 'org-456' }, 'member-123', 'company')).toEqual({
      accessToken: 'token',
      orgId: 'org-456',
    });
  });

  it('keeps organization identity ahead of a personal identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:456' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await linkedinPost('Company update', [], false, undefined, {
      accessToken: 'token',
      orgId: 'org-456',
      personId: 'member-123',
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      author: 'urn:li:organization:org-456',
    });
  });
});
