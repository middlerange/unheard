import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_RESEARCH_TOOL_NAME, anthropicResearchOutput, anthropicResearchRequest, anthropicResearchSchema } from './research-anthropic';
import { callResearchModel, RESEARCH_MODEL, evidenceJsonSchema, evidenceJsonSchemaForItems, ResearchModelRateLimitError } from './research-model';
import { beginResearchUsage, finishResearchUsage } from './research-usage';

const rejectionWrites = vi.hoisted(() => vi.fn());
const rejectionStorage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./db/client', () => ({ getDb: async () => ({ insert: () => ({ values: (value: unknown) => {
  rejectionWrites(value);
  return { onConflictDoNothing: rejectionStorage };
} }) }) }));
vi.mock('./research-usage', () => ({
  beginResearchUsage: vi.fn(async () => 'usage-id'),
  finishResearchUsage: vi.fn(async () => {}),
}));
const context = { teamId: 'team', runId: 'run', stage: 'research' as const, operation: 'screen' };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); rejectionStorage.mockReset().mockResolvedValue(undefined); });

function mockMessage(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    id: 'msg-test', model: RESEARCH_MODEL, stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"findings":[]}' }],
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 },
    ...overrides,
  }));
}

describe('Claude research transport', () => {
  const submitted = { findings: { source: { claim: { summary: 'Submitted assessment data' } } } };
  const toolBlock = { type: 'tool_use', id: 'tool-test', name: ANTHROPIC_RESEARCH_TOOL_NAME, input: submitted };
  it('forces a data-only tool without strict grammar while default screening retains output_config', () => {
    const schema = { type: 'object', properties: { findings: { type: 'object' } }, required: ['findings'], additionalProperties: false };
    const request = anthropicResearchRequest(RESEARCH_MODEL, 'system', {}, schema, 16384, 'tool');
    expect(request).toMatchObject({ max_tokens: 16384, thinking: { type: 'disabled' },
      tool_choice: { type: 'tool', name: ANTHROPIC_RESEARCH_TOOL_NAME, disable_parallel_tool_use: true } });
    expect(request).not.toHaveProperty('output_config');
    if (!('tools' in request)) throw new Error('Tool request missing tools');
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0].input_schema).toBe(schema);
    expect(request.tools[0]).not.toHaveProperty('strict');
    const screening = anthropicResearchRequest(RESEARCH_MODEL, 'screen', {}, schema, 100);
    expect(screening).toHaveProperty('output_config.format.type', 'json_schema');
    expect(screening).not.toHaveProperty('tools');
    expect(screening).not.toHaveProperty('tool_choice');
  });

  it.each(['evidence', 'replay_evidence'])('uses strict schema for a single-source %s request and accepts only schema completion', async operation => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const fetcher = mockMessage({ content: [{ type: 'text', text: JSON.stringify(submitted) }] });
    const usageContext = { ...context, operation };
    const data = { items: [{ id: 'source' }] }, schema = evidenceJsonSchemaForItems(['source'], ['personal'], { sectionCoverage: true });
    const result = await callResearchModel('evidence', data, schema, 16384, usageContext);
    expect(result).toEqual({ value: submitted, inputTokens: 140, outputTokens: 20 });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toHaveProperty('output_config.format.type', 'json_schema');
    expect(body.output_config.format.schema.properties.findings.required).toEqual(['source']);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body.max_tokens).toBe(16384);
    expect(finishResearchUsage).toHaveBeenCalledWith('usage-id', usageContext, expect.objectContaining({ status: 'completed' }));
    fetcher.mockResolvedValueOnce(Response.json({ stop_reason: 'tool_use', content: [toolBlock] }));
    await expect(callResearchModel('evidence', data, schema, 16384, usageContext)).rejects.toThrow('did not complete');
  });

  it.each(['evidence', 'replay_evidence'])('retains tool submission for multi-source %s requests and records a valid single submission as complete', async operation => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const fetcher = mockMessage({ stop_reason: 'tool_use', content: [toolBlock] });
    const usageContext = { ...context, operation };
    const result = await callResearchModel('evidence', { items: [{ id: 'first' }, { id: 'second' }] }, evidenceJsonSchema, 16384, usageContext);
    expect(result).toEqual({ value: submitted, inputTokens: 140, outputTokens: 20 });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('output_config');
    expect(body.tools[0].name).toBe(ANTHROPIC_RESEARCH_TOOL_NAME);
    expect(body.tools[0]).not.toHaveProperty('strict');
    expect(finishResearchUsage).toHaveBeenCalledWith('usage-id', usageContext, expect.objectContaining({ status: 'completed' }));
  });

  it.each([
    [], [toolBlock, toolBlock], [{ ...toolBlock, name: 'foreign_tool' }],
    [{ ...toolBlock, input: null }], [{ ...toolBlock, input: [] }],
    [{ ...toolBlock, input: 'unparsed input' }], [{ type: 'text', text: JSON.stringify(submitted) }],
    [{ type: 'text', text: 'Additional response' }, toolBlock], [{ ...toolBlock, input: undefined }],
  ])('rejects incomplete, multiple, foreign or non-object tool data %j', async (...content) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    mockMessage({ stop_reason: 'tool_use', content });
    const usageContext = { ...context, operation: 'evidence' };
    await expect(callResearchModel('evidence', {}, {}, 100, usageContext)).rejects.toThrow('did not complete');
    expect(finishResearchUsage).toHaveBeenNthCalledWith(1, 'usage-id', usageContext, expect.objectContaining({ status: 'tool_use', usage: expect.objectContaining({ output_tokens: 20 }) }));
    expect(anthropicResearchOutput({ stop_reason: 'tool_use', content }, 'tool')).toBe('');
  });

  it.each(['max_tokens', 'unknown', 'pause_turn'])('does not treat a tool block stopped by %s as completed', async stop_reason => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test'); mockMessage({ stop_reason, content: [toolBlock] });
    const usageContext = { ...context, operation: 'evidence' };
    await expect(callResearchModel('evidence', {}, {}, 100, usageContext)).rejects.toThrow('did not complete');
    expect(finishResearchUsage).toHaveBeenNthCalledWith(1, 'usage-id', usageContext, expect.objectContaining({ status: stop_reason }));
  });

  it('preserves legacy completed text mocks for evidence but never accepts tool use during screening', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const fetcher = mockMessage();
    expect((await callResearchModel('evidence', {}, {}, 100, { ...context, operation: 'evidence' })).value).toEqual({ findings: [] });
    fetcher.mockResolvedValueOnce(Response.json({ stop_reason: 'tool_use', content: [toolBlock] }));
    await expect(callResearchModel('screen', {}, {}, 100, context)).rejects.toThrow('did not complete');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toHaveProperty('output_config');
    expect(anthropicResearchOutput({ stop_reason: 'end_turn', content: [toolBlock] }, 'tool')).toBe('');
  });

  it('sends native Messages requests and retains cache-inclusive usage', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
    const fetcher = mockMessage();
    const result = await callResearchModel('Evidence instructions', [{ id: 'a' }], evidenceJsonSchema, 4000, context);
    expect(result).toEqual({ value: { findings: [] }, inputTokens: 140, outputTokens: 20 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.headers).toEqual({ 'x-api-key': 'anthropic-test-key', 'anthropic-version': '2026-10-21', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 4000, system: 'Evidence instructions', service_tier: 'standard_only', thinking: { type: 'disabled' }, messages: [{ role: 'user', content: '[{"id":"a"}]' }] });
    expect(body).not.toHaveProperty('reasoning');
    expect(body.output_config.format.schema.properties.findings).not.toHaveProperty('maxItems');
    expect(body.output_config.format.schema.properties.findings.items.properties.score.description).toContain('maximum: 100');
    expect(evidenceJsonSchema.properties.findings.maxItems).toBe(12);
    expect(finishResearchUsage).toHaveBeenCalledWith('usage-id', context, expect.objectContaining({ model: RESEARCH_MODEL, responseId: 'msg-test', tier: 'standard', status: 'completed' }));
  });

  it('requires the Anthropic secret even when an OpenAI key is present', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', 'existing-openai-key');
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('ANTHROPIC_API_KEY');
    expect(fetcher).not.toHaveBeenCalled();
    expect(beginResearchUsage).not.toHaveBeenCalled();
  });

  it.each(['max_tokens', 'refusal', 'pause_turn'])('records usage but rejects %s responses', async stop_reason => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test'); mockMessage({ stop_reason });
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('did not complete');
    expect(finishResearchUsage).toHaveBeenNthCalledWith(1, 'usage-id', context, expect.objectContaining({ status: stop_reason, usage: expect.objectContaining({ input_tokens: 100 }) }));
  });

  it.each([{ content: [] }, { content: [{ type: 'text', text: 'invalid JSON' }] }])('rejects empty or malformed output after recording billed tokens', async response => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test'); mockMessage(response);
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow();
    expect(finishResearchUsage).toHaveBeenNthCalledWith(1, 'usage-id', context, expect.objectContaining({ status: 'completed', usage: expect.objectContaining({ output_tokens: 20 }) }));
  });

  it('redacts provider errors and never exposes the response body', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private provider details', { status: 401 }));
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('Anthropic request rejected (HTTP 401)');
    expect(finishResearchUsage).toHaveBeenNthCalledWith(1, 'usage-id', context, { model: RESEARCH_MODEL, tier: 'default', status: 'http_401' });
    expect(rejectionWrites).toHaveBeenCalledWith(expect.objectContaining({ id: 'research-provider-error:usage-id', team_id: 'team' }));
    expect(JSON.stringify(rejectionWrites.mock.calls)).not.toContain('private provider details');
  });

  it('keeps explicit Sol writing on the OpenAI transport', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-test');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }));
    await callResearchModel('writer', {}, {}, 100, context, 'gpt-6-sol');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'none' } });
  });

  it('preserves a known rejection when diagnostic-only storage fails', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { type: 'rate_limit_error' } }, { status: 429 }));
    rejectionStorage.mockRejectedValueOnce(new Error('Diagnostic cache unavailable'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toBeInstanceOf(ResearchModelRateLimitError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(finishResearchUsage).toHaveBeenCalledTimes(1);
    expect(finishResearchUsage).toHaveBeenCalledWith('usage-id', context, expect.objectContaining({ status: 'http_429' }));
    expect(logger).toHaveBeenCalledWith('Provider rejection diagnostic storage failed', expect.objectContaining({ temporary: true }));
  });

  it('fails visibly if known-rejection usage cannot be persisted, without mislabeling it unknown', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: { type: 'rate_limit_error' } }, { status: 429 }));
    vi.mocked(finishResearchUsage).mockRejectedValueOnce(new Error('Usage storage unavailable'));
    await expect(callResearchModel('system', {}, {}, 100, context)).rejects.toThrow('HTTP 429; rate_limit_error');
    expect(finishResearchUsage).toHaveBeenCalledTimes(1);
    expect(rejectionWrites).not.toHaveBeenCalled();
  });

  it('preserves schema property names and enums while translating constraints', () => {
    const schema = { type: 'object', properties: { maxItems: { type: 'array', minItems: 3, items: { type: 'string', minLength: 20, enum: ['minimum', 'maxItems'] } } } };
    expect(anthropicResearchSchema(schema)).toEqual({ type: 'object', properties: { maxItems: { type: 'array', description: 'minItems: 3', items: { type: 'string', description: 'minLength: 20', enum: ['minimum', 'maxItems'] } } } });
    expect(anthropicResearchRequest(RESEARCH_MODEL, 'system', {}, {}, 100).max_tokens).toBe(100);
  });
});
