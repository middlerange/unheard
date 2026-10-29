import { afterEach, expect, it, vi } from 'vitest';
import { checkResearchProviders, researchProvidersHttp } from './research-providers';
import { getRequestTeamId } from './auth';

vi.mock('./auth', () => ({ getRequestTeamId: vi.fn(async () => 'team' as string | Response) }));
const originalKey = process.env.ANTHROPIC_API_KEY;
const secret = 'sk-ant-private-not-for-output';
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
  vi.mocked(getRequestTeamId).mockResolvedValue('team');
  vi.unstubAllGlobals();
});

it.each(['claude-haiku-5-5', 'claude-haiku-5-5-20261021'])('checks metadata with the bound key without implying generation or balance access: %s', async resolvedModelId => {
  process.env.ANTHROPIC_API_KEY = secret;
  const fetcher = vi.fn(async () => Response.json({ type: 'model', id: resolvedModelId, display_name: secret }, { headers: { 'request-id': 'req_metadata_12345' } }));
  const result = await checkResearchProviders(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/models/claude-haiku-5-5', expect.objectContaining({
    method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal),
    headers: { 'x-api-key': secret, 'anthropic-version': '2026-10-21', Accept: 'application/json' },
  }));
  expect(fetcher.mock.calls[0]).toHaveLength(2);
  expect(result.research).toMatchObject({ status: 'metadata_accessible', resolvedModelId, httpStatus: 200, bodyKind: 'json', contentType: 'application/json', requestId: 'req_metadata_12345', generationAccess: 'not_tested', accountBalance: 'not_checked', automaticRetry: false });
  expect(result.writing).toEqual({ provider: 'OpenAI', model: 'gpt-6-sol', checked: false });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('distinguishes a JSON permission rejection from HTML edge rejection without retaining either body', async () => {
  process.env.ANTHROPIC_API_KEY = secret;
  for (const [response, expected] of [
    [Response.json({ error: { type: 'permission_error', message: secret } }, { status: 403, headers: { 'request-id': 'req_permission_123' } }), { type: 'permission_error', bodyKind: 'json', contentType: 'application/json', requestId: 'req_permission_123' }],
    [new Response(`<html>${secret} edge denied</html>`, { status: 403, headers: { 'content-type': 'text/html; charset=UTF-8' } }), { type: null, bodyKind: 'html', contentType: 'text/html', requestId: null }],
  ] as const) {
    const fetcher = vi.fn(async () => response);
    const result = await checkResearchProviders(fetcher);
    expect(result.research).toMatchObject({ status: 'rejected', httpStatus: 403, ...expected });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('edge denied');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it('does not accept an HTML200 or malformed JSON as verified model metadata', async () => {
  process.env.ANTHROPIC_API_KEY = secret;
  for (const [response, bodyKind] of [
    [new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), 'html'],
    [new Response('broken-json', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [Response.json({ type: 'model', id: 'claude-unrelated-model' }), 'json'],
    [Response.json({ type: 'model', id: `claude-haiku-5-5-${secret}` }), 'json'],
  ] as const) expect((await checkResearchProviders(vi.fn(async () => response))).research).toMatchObject({ status: 'unexpected_response', bodyKind });
});

it('returns safe missing-key and transport outcomes without retrying or exposing exception text', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const missing = vi.fn();
  expect((await checkResearchProviders(missing)).research.status).toBe('unconfigured');
  expect(missing).not.toHaveBeenCalled();
  process.env.ANTHROPIC_API_KEY = secret;
  const failed = vi.fn(async () => { throw new Error(secret); });
  const result = await checkResearchProviders(failed);
  expect(result.research).toMatchObject({ status: 'transport_error', httpStatus: null });
  expect(failed).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('authenticates before provider access and keeps the successful response uncached', async () => {
  process.env.ANTHROPIC_API_KEY = secret;
  const fetcher = vi.fn(async () => Response.json({ type: 'model', id: 'claude-haiku-5-5' }));
  vi.stubGlobal('fetch', fetcher);
  vi.mocked(getRequestTeamId).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
  expect((await researchProvidersHttp(new Request('https://app.test/api/research/providers', { method: 'POST' }))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  const response = await researchProvidersHttp(new Request('https://app.test/api/research/providers', { method: 'POST' }));
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).research.status).toBe('metadata_accessible');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports redirects without forwarding the bound key to another destination', async () => {
  process.env.ANTHROPIC_API_KEY = secret;
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.redirect !== 'manual') throw new TypeError('Workers supports only follow or manual');
    return new Response(null, { status: 302, headers: { location: 'https://other.example/' + secret } });
  });
  const result = await checkResearchProviders(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.research).toMatchObject({ status: 'rejected', httpStatus: 302, bodyKind: 'empty' });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('other.example');
});

it.each([{ operation: 'generation_health' }, { operation: 'generation_health', operationId: 'not-a-uuid' }, { operation: 'generation_health', operationId: 'b1000000-0000-4000-8000-000000000001', model: 'other' }, { operation: 'generation_health', operationId: 'b1000000-0000-4000-8000-000000000001', prompt: 'private supplied prompt' }, { operation: 'metadata', operationId: 'b1000000-0000-4000-8000-000000000001' }, { operation: 'other' }])('rejects arbitrary provider request parameters before inference: %j', async body => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const response = await researchProvidersHttp(new Request('https://app.test/api/research/providers', { method: 'POST', body: JSON.stringify(body) }));
  expect(response.status).toBe(400); expect(fetcher).not.toHaveBeenCalled(); expect(JSON.stringify(await response.json())).not.toContain('private supplied prompt');
});
it.each(['', '{}', '{"operation":"metadata"}'])('keeps default/explicit metadata free of generation: %s', async body => {
  process.env.ANTHROPIC_API_KEY = secret; const fetcher = vi.fn(async (_url: unknown) => Response.json({ type: 'model', id: 'claude-haiku-5-5' })); vi.stubGlobal('fetch', fetcher);
  const response = await researchProvidersHttp(new Request('https://app.test/api/research/providers', { method: 'POST', ...(body ? { body } : {}) }));
  expect(response.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models/claude-haiku-5-5');
});
it('rejects oversized bodies and unknown keys without echoing untrusted key names', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const body of [JSON.stringify({ [secret]: true }), 'x'.repeat(513)]) { const response = await researchProvidersHttp(new Request('https://app.test/api/research/providers', { method: 'POST', body })); expect(response.status).toBe(400); expect(JSON.stringify(await response.json())).not.toContain(secret); }
  expect(fetcher).not.toHaveBeenCalled();
});
