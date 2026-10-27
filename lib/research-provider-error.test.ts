import { expect, it } from 'vitest';
import { researchProviderRejection, ResearchModelRateLimitError } from './research-provider-error';

it('waits for the longest provider reset only for a known rejected rate-limit request', async () => {
  const response = Response.json({ error: { code: 'rate_limit_exceeded', message: 'not retained' } }, {
    status: 429, headers: { 'retry-after': '2', 'x-ratelimit-reset-tokens': '1m2.5s', 'x-ratelimit-reset-requests': '4ms', 'x-request-id': 'req_rate_limit_123', 'x-ratelimit-limit-tokens': '100000' },
  });
  const result = await researchProviderRejection(response, 'OpenAI');
  expect(result.error).toBeInstanceOf(ResearchModelRateLimitError);
  expect(result.diagnostic).toMatchObject({ code: 'rate_limit_exceeded', temporary: true, retryAfterMs: 63500, requestId: 'req_rate_limit_123', limits: { 'x-ratelimit-limit-tokens': 100000 } });
});

it('never treats an account quota, unknown rejection or transport outcome as a temporary rate limit', async () => {
  for (const body of [{ error: { code: 'insufficient_quota', type: 'rate_limit_error' } }, { error: { type: 'insufficient_quota' } }, { error: { code: 'future_quota_code', type: 'rate_limit_error' } }, { error: { code: 'invalid_api_key', type: 'rate_limit_error' } }, { error: { code: 'rate_limit_exceeded', type: 'permission_error' } }, { error: { message: 'Try later' } }]) {
    const result = await researchProviderRejection(Response.json(body, { status: 429 }), 'OpenAI');
    expect(result.error).not.toBeInstanceOf(ResearchModelRateLimitError);
    expect(result.diagnostic.temporary).toBe(false);
    expect(result.diagnostic.retryAfterMs).toBeNull();
  }
  const result = await researchProviderRejection(new Response('gateway response', { status: 502 }), 'OpenAI');
  expect(result.diagnostic).toMatchObject({ httpStatus: 502, code: null, type: null, temporary: false });
});

it('records only allowed diagnostic fields and never echoes provider credentials or response text', async () => {
  const secret = 'sk-private-key-that-must-not-be-recorded';
  const result = await researchProviderRejection(Response.json({ error: { code: secret, type: secret, message: `Incorrect key ${secret}` }, input: 'private source' }, {
    status: 401, headers: { 'x-request-id': `req_${secret}`, 'x-ratelimit-limit-tokens': secret },
  }), 'OpenAI');
  expect(JSON.stringify(result.diagnostic) + result.error.message).not.toContain(secret);
  expect(JSON.stringify(result.diagnostic)).not.toContain('private source');
  expect(result.diagnostic).toMatchObject({ code: null, type: null, requestId: null, limits: {} });
});

it('supports Anthropic rate-limit types and HTTP-date retry headers without retrying server errors', async () => {
  const now = Date.parse('2026-10-27T09:00:00Z');
  const response = Response.json({ error: { type: 'rate_limit_error' } }, { status: 429, headers: { 'retry-after': 'Tue, 27 Oct 2026 09:01:00 GMT' } });
  const limited = await researchProviderRejection(response, 'Anthropic', now);
  expect(limited.error).toBeInstanceOf(ResearchModelRateLimitError);
  expect(limited.diagnostic.retryAfterMs).toBe(61000);
  const overloaded = await researchProviderRejection(Response.json({ error: { type: 'overloaded_error' } }, { status: 529 }), 'Anthropic');
  expect(overloaded.error).not.toBeInstanceOf(ResearchModelRateLimitError);
  expect(overloaded.diagnostic.temporary).toBe(false);
});
