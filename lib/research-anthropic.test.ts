import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { researchSourcePacketSchemaV9 } from './research-source-packet-model';
import { ANTHROPIC_RESEARCH_TOOL_NAME, anthropicResearchOutput, anthropicResearchRequest, anthropicResearchSchema, anthropicStrictResearchSchema } from './research-anthropic';
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
  it('uses Sonnet between-tool thinking and automatic nonparallel submission without strict grammar', () => {
    const schema={type:'object',properties:{findings:{type:'object'}},required:['findings'],additionalProperties:false};
    for(const model of ['claude-sonnet-5-5','claude-sonnet-5-5-2026-10-28']){
      const request=anthropicResearchRequest(model,'system',{items:[{id:'source'}]},schema,16000,'tool');
      expect(request).toMatchObject({model,thinking:{type:'between_tools'},tool_choice:{type:'auto',disable_parallel_tool_use:true}});
      if(!('tools' in request))throw new Error('Sonnet tool request missing tools');
      expect(request.tool_choice).not.toHaveProperty('name');expect(request).not.toHaveProperty('output_config');
      expect(request.tools).toHaveLength(1);expect(request.tools![0].input_schema).toBe(schema);expect(request.tools![0]).not.toHaveProperty('strict');
    }
  });
  it('retains byte-compatible Haiku request formatting in both existing modes', () => {
    const schema={type:'object',properties:{}},prefix={model:RESEARCH_MODEL,system:'system',messages:[{role:'user',content:'{"id":"source"}'}],max_tokens:100,service_tier:'standard_only',thinking:{type:'disabled'}};
    expect(JSON.stringify(anthropicResearchRequest(RESEARCH_MODEL,'system',{id:'source'},schema,100))).toBe(JSON.stringify({...prefix,output_config:{format:{type:'json_schema',schema}}}));
    expect(JSON.stringify(anthropicResearchRequest(RESEARCH_MODEL,'system',{id:'source'},schema,100,'tool'))).toBe(JSON.stringify({...prefix,tools:[{name:ANTHROPIC_RESEARCH_TOOL_NAME,description:'Submit the research assessment data for application validation. This tool performs no external action.',input_schema:schema}],tool_choice:{type:'tool',name:ANTHROPIC_RESEARCH_TOOL_NAME,disable_parallel_tool_use:true}}));
  });
  it('accepts one Sonnet tool input alongside transport text/thinking without extracting either', () => {
    const response={stop_reason:'tool_use',content:[{type:'thinking',thinking:'private reasoning transport'},{type:'text',text:'Non-data explanation'},toolBlock,{type:'redacted_thinking',data:'private opaque transport'}]};
    expect(anthropicResearchOutput(response,'tool','claude-sonnet-5-5')).toBe(JSON.stringify(submitted));
    expect(anthropicResearchOutput(response,'tool',RESEARCH_MODEL)).toBe('');
    expect(anthropicResearchOutput({...response,stop_reason:'max_tokens'},'tool','claude-sonnet-5-5')).toBe('');
    const textOnly={stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(submitted)}]};
    expect(anthropicResearchOutput(textOnly,'tool','claude-sonnet-5-5')).toBe('');
    expect(anthropicResearchOutput(textOnly,'tool',RESEARCH_MODEL)).toBe(JSON.stringify(submitted));
  });
  it.each([
    [toolBlock,toolBlock],[toolBlock,{...toolBlock,name:'foreign_tool'}],[{...toolBlock,name:'foreign_tool'}],
    [toolBlock,{type:'server_tool_use'}],[toolBlock,{type:'unknown'}],[{type:'thinking'}],
    [{...toolBlock,input:null}],[{...toolBlock,input:[]}],
  ])('rejects unknown/multiple Sonnet tool blocks or missing structured input %j', (...content) => {
    expect(anthropicResearchOutput({stop_reason:'tool_use',content},'tool','claude-sonnet-5-5')).toBe('');
  });
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

describe('separately pinned strict research tool transport', () => {
  const packet = { id: 'packet', primarySourceId: 'primary', relationship: { type: 'same_product' as const,
    reason: 'Three related public descriptions of the same product.', sourceIds: ['primary', 'reference', 'third'] },
    sources: ['primary', 'reference', 'third'].map(id => ({ id, url: 'https://publisher.example/' + id, publishedAt: null, firstSeen: 1000, content: 'A documented draft can be inspected before approval.' })) };
  const profiles = ['personal', 'company', 'third-profile', 'fourth-profile'];
  function value(mode: string, kind: string) {
    const frame = { primarySourceId: 'primary', evidenceCitations: [{ sourceId: 'primary', passageIds: [0] }, { sourceId: 'reference', passageIds: [0] }],
      relationshipSupport: 'bounded_inference', relationshipExplanation: 'A documented draft supports our proposed inspection, not an outcome.', claimBasis: 'described_method',
      profileChecks: profiles.map(profileId => ({ profileId, fits: true, relevance: 22, reason: 'An inspectable decision.' })), familyKey: 'inspect-draft',
      qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' },
      claim: { readerDecision: { mode, question: 'What should be inspected?', answer: 'Inspect the documented artifact.', ...(mode === 'proposed_evaluation' ? { inspection: {
        output: 'The draft.', action: 'Read it against supplied material.', decisionCriterion: 'Whether it preserves the required material.', basis: 'analyst_proposed' } } : {}) },
        factualCore: kind === 'mechanism' ? { kind, input: 'Supplied material.', action: 'Create a draft.', output: 'A draft.', conditions: null } : { kind, observation: 'The publisher describes a reviewable draft.' },
        whyItMatters: 'An explicit boundary.', limitations: 'The proposed inspection is our inference, not an observed result.' } };
    return { findings: { packet: { ...frame, additionalIdeas: [{ ...frame, familyKey: 'child-inspection' }] } } };
  }
  it('safely lowers actual three-document/four-profile V9 unions while preserving structural branches and references', () => {
    const original = researchSourcePacketSchemaV9(packet, profiles), before = JSON.stringify(original), lowered = anthropicStrictResearchSchema(original);
    expect(JSON.stringify(original)).toBe(before); expect(anthropicStrictResearchSchema(lowered)).toEqual(lowered);
    expect(JSON.stringify(lowered)).not.toContain('"oneOf":');
    expect(lowered).toMatchObject({ type: 'object', additionalProperties: false, required: ['findings'] });
    const originalParser = z.fromJSONSchema(JSON.parse(before)), providerParser = z.fromJSONSchema(JSON.parse(JSON.stringify(lowered)));
    for (const mode of ['informative', 'application', 'proposed_evaluation']) for (const kind of ['observation', 'mechanism']) {
      const raw = value(mode, kind);
      expect(originalParser.safeParse(raw).success).toBe(true); expect(providerParser.safeParse(raw).success).toBe(true);
      delete (raw.findings.packet.additionalIdeas[0].claim.readerDecision as { question?: string }).question;
      expect(originalParser.safeParse(raw).success).toBe(false); expect(providerParser.safeParse(raw).success).toBe(false);
    }
    for (const findings of ['{"packet":{}}', '{"packet":{}}}', [], null]) {
      expect(originalParser.safeParse({ findings }).success).toBe(false); expect(providerParser.safeParse({ findings }).success).toBe(false);
    }
    const outOfRange = value('informative', 'observation'); outOfRange.findings.packet.profileChecks[0].relevance = 99;
    expect(originalParser.safeParse(outOfRange).success).toBe(false);
    expect(providerParser.safeParse(outOfRange).success).toBe(true);
    expect(JSON.stringify(lowered)).toContain('maximum: 30');
  });
  it('rejects overlapping or untagged oneOf, unsupported keywords, unresolved/external/recursive refs and open objects', () => {
    const schemas = [
      { oneOf: [{ type: 'string' }, { type: 'string' }] },
      { oneOf: ['a', 'b'].map(() => ({ type: 'object', properties: { mode: { const: 'same' } }, required: ['mode'], additionalProperties: false })) },
      { type: 'string', pattern: '(?=hidden)' }, { type: 'string', not: { const: 'hidden' } },
      { $ref: 'https://publisher.example/schema' }, { $ref: '#/$defs/missing' },
      { $defs: { cycle: { $ref: '#/$defs/cycle' } }, $ref: '#/$defs/cycle' },
      { type: 'object', properties: {}, required: [], additionalProperties: true },
      { allOf: [{ $ref: '#/$defs/item' }], $defs: { item: { type: 'string' } } },
    ];
    for (const schema of schemas) expect(() => anthropicStrictResearchSchema(schema)).toThrow();
  });
  it('enforces provider complexity limits on expanded reference usage', () => {
    const repeated = (count: number, definition: object) => ({ type: 'object', properties: Object.fromEntries(Array.from({ length: count }, (_, i) => ['field' + i, { $ref: '#/$defs/repeated' }])),
      required: Array.from({ length: count }, (_, i) => 'field' + i), additionalProperties: false, $defs: { repeated: definition } });
    const union = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(() => anthropicStrictResearchSchema(repeated(16, union))).not.toThrow();
    expect(() => anthropicStrictResearchSchema(repeated(17, union))).toThrow('complexity');
    const optional = { type: 'object', properties: { optional: { type: 'string' } }, required: [], additionalProperties: false };
    expect(() => anthropicStrictResearchSchema(repeated(24, optional))).not.toThrow();
    expect(() => anthropicStrictResearchSchema(repeated(25, optional))).toThrow('complexity');
  });
  it('sets strict only on the opt-in tool, preserves Sonnet thinking/choice and sends the already frozen lowered schema', () => {
    const schema = anthropicStrictResearchSchema(researchSourcePacketSchemaV9(packet, profiles));
    const request = anthropicResearchRequest('claude-sonnet-5-5', 'same instructions', { items: [] }, schema, 16384, 'strict-tool');
    expect(request).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16384, thinking: { type: 'between_tools' }, tool_choice: { type: 'auto', disable_parallel_tool_use: true } });
    if (!('tools' in request)) throw Error('Strict tool request missing tools');
    expect(request.tools[0]).toMatchObject({ name: 'submit_research', strict: true, input_schema: schema }); expect(request).not.toHaveProperty('output_config');
    const old = anthropicResearchRequest('claude-sonnet-5-5', 'same instructions', {}, schema, 16384, 'tool');
    if (!('tools' in old)) throw Error('Legacy tool request missing tools');
    expect(old.tools[0]).not.toHaveProperty('strict'); expect(old.tools[0].input_schema).toBe(schema);
  });
  it('routes only the explicit strict marker to strict-tool and never decodes nested findings strings', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    const raw = { findings: '{"packet":{}}}' }, fetcher = mockMessage({ model: 'claude-sonnet-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_research', input: raw }] });
    const schema = anthropicStrictResearchSchema(researchSourcePacketSchemaV9(packet, profiles));
    const result = await callResearchModel('frozen instructions', { items: [{ id: 'packet', reviewTransport: 'anthropic-strict-tool-v1' }] }, schema, 16384, { ...context, operation: 'replay_packet_evidence' }, 'claude-sonnet-5-5');
    expect(result.value).toEqual(raw); expect(typeof result.value.findings).toBe('string');
    const wire = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(wire.tools[0]).toMatchObject({ strict: true, input_schema: schema }); expect(wire).not.toHaveProperty('output_config');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(anthropicResearchOutput({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: 'submit_research', input: raw }] }, 'strict-tool', 'claude-sonnet-5-5')).toBe('');
  });
});
