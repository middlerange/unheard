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

it.each([
  ['Schema is too complex for compilation.', 'schema_complexity'],
  ['The compiled grammar is too large.', 'schema_complexity'],
  ['max_tokens must be less than or equal to 8192.', 'output_token_limit'],
  ['max_output_tokens exceeds the maximum supported value.', 'output_token_limit'],
  ['JSON schema: allOf with $ref is not supported.', 'unsupported_schema'],
  ['additionalProperties must be false.', 'unsupported_schema'],
  ['Invalid header anthropic-version: unsupported version.', 'unsupported_api_version'],
  ['messages.0.content: Input should be a valid list.', 'request_format'],
  ['output_config.format: Field required.', 'request_format'],
  ['The request could not be processed.', null],
])('retains only a fixed configuration category for a known 400: %s', async (message, expected) => {
  const result = await researchProviderRejection(Response.json({ error: { type: 'invalid_request_error', message } }, { status: 400 }), 'Anthropic');
  expect(result.diagnostic.configurationIssue).toBe(expected);
  expect(result.diagnostic.temporary).toBe(false);
  expect(result.error).not.toBeInstanceOf(ResearchModelRateLimitError);
  expect(JSON.stringify(result.diagnostic) + result.error.message).not.toContain(message);
  if (expected) expect(result.error.message).toContain('Check request configuration.');
});

it('does not classify configuration from unknown codes, other statuses or non-string messages', async () => {
  for (const [status, type, message] of [
    [400, 'future_request_error', 'Schema is too complex for compilation.'],
    [401, 'invalid_request_error', 'Schema is too complex for compilation.'],
    [429, 'invalid_request_error', 'Schema is too complex for compilation.'],
    [400, 'invalid_request_error', { schema: 'too complex', private: 'Do not retain' }],
  ] as const) {
    const result = await researchProviderRejection(Response.json({ error: { type, message } }, { status }), 'Anthropic');
    expect(result.diagnostic.configurationIssue).toBeNull();
  }
});

it('never retains secret-containing provider messages even when they identify a schema problem', async () => {
  const secret = 'sk-private-key-and-embedded-prompt';
  const message = `Schema is too complex for compilation. Authorization: ${secret}; private source and prompt follow.`;
  const result = await researchProviderRejection(Response.json({ error: { type: 'invalid_request_error', message }, prompt: secret }, { status: 400 }), 'Anthropic');
  expect(result.diagnostic.configurationIssue).toBe('schema_complexity');
  const retained = JSON.stringify(result.diagnostic) + result.error.message;
  expect(retained).not.toContain(secret);
  expect(retained).not.toContain('private source');
  expect(retained).not.toContain('Authorization');
  expect(retained).not.toContain(message);
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

it('classifies rejection bodies safely and cancels oversized bodies', async () => {
  const secret = 'sk-private-header-and-body';
  for (const [content, mime, expected] of [
    [`<html>${secret}</html>`, 'text/html; charset=utf-8', { contentType: 'text/html', bodyKind: 'html' }],
    [secret, 'application/json', { contentType: 'application/json', bodyKind: 'invalid_json' }],
    [secret, secret, { contentType: 'other', bodyKind: 'text' }],
  ] as const) {
    const result = await researchProviderRejection(new Response(content, { status: 403, headers: { 'content-type': mime, 'request-id': `req_${secret}` } }), 'Anthropic');
    expect(result.diagnostic).toMatchObject({ ...expected, requestId: null });
    expect(JSON.stringify(result.diagnostic)).not.toContain(secret);
  }
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(70_000)); }, cancel() { cancelled = true; } });
  const result = await researchProviderRejection(new Response(body, { status: 403 }), 'Anthropic');
  expect(result.diagnostic).toMatchObject({ bodyKind: 'oversized', code: null, type: null });
  expect(cancelled).toBe(true);
});

it('reports only fixed rejection reasons and structural types for nonstandard JSON403', async () => {
  const secret = 'sk-private-body-header-and-prompt';
  for (const error of [secret, { [secret]: secret, code: secret, type: secret, message: secret }, null]) {
    const result = await researchProviderRejection(Response.json({ error, [secret]: secret }, { status: 403, headers: { 'x-private': secret } }), 'Anthropic');
    expect(result.diagnostic.reasonClassification).toBe('unclassified_json_rejection'); expect(result.diagnostic.shape.topLevel).toBe('object');
    expect(JSON.stringify(result.diagnostic) + result.error.message).not.toContain(secret); expect(result.diagnostic.temporary).toBe(false);
  }
});
