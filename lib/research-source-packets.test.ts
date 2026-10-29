import { describe, expect, it, vi } from 'vitest';
import { parseResearchAudience } from './research-audience';
import { researchSelectionAudience, RESEARCH_SELECTION_VIEW_VERSION } from './research-selection-audience';
import { researchPacketsFromDefinitions, configuredResearchPacketDefinitions, reviewResearchSourcePackets, researchSourcePacketPolicy, researchSourcePacketPolicyContract, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW, ResearchSourcePacketPending, type ResearchPacketAccess } from './research-source-packets';
import { researchHash } from './research-model';
import type { ResearchSourcePacket } from './research-source-packet-model';
import type { ResearchSourceSeed } from './research-types';

const body = 'The original publisher describes collecting account context and creating a draft with human approval. '.repeat(7);
const audience = parseResearchAudience('Product decisions.\n\nPublishing profiles: '+JSON.stringify([{ id: 'personal', name: 'Personal', platform: 'linkedin', systemPrompt: 'Product building and documented workflows.' }]));
const items = [
  { id: 'primary', sourceId: 'archive-origin', url: 'https://publisher.example/connector', publishedAt: 1000, discoveredAt: 2000, content: body },
  { id: 'reference', sourceId: 'documentation', url: 'https://publisher.example/create', publishedAt: null, discoveredAt: 3000, content: body },
];
const definition = { id: 'workflow', primarySourceId: 'primary', sourceIds: ['primary', 'reference'], relationship: { type: 'same_publisher' as const, reason: 'Both pages document the same publisher connector.' } };
const packet = () => researchPacketsFromDefinitions([definition], items)[0];
function response(input: ResearchSourcePacket) {
  return { findings: { [input.id]: { primarySourceId: input.primarySourceId,
    evidenceCitations: input.sources.map(source => ({ sourceId: source.id, passageIds: [0] })),
    relationshipSupport: 'documented_relationship', relationshipExplanation: 'Both documents explicitly describe the same approved creation operation.',
    claimBasis: 'described_method', profileChecks: [{ profileId: 'personal', fits: true, relevance: 22, reason: 'A specific supported review and creation handoff.' }],
    claim: { summary: 'The publisher describes reviewing context before creating an approved draft.', contentAngle: 'Inspect the documented review-to-creation handoff.', whyItMatters: 'The approval boundary is explicit.', limitations: 'Publisher documentation describes capability; no customer outcome is established.' },
    familyKey: 'review-create', qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' }, additionalIdeas: [],
  } } };
}
function harness(generate = vi.fn(async () => response(packet()))) {
  const values = new Map<string, unknown>(); let clock = 10_000;
  const copy = <T>(value: T): T => structuredClone(value);
  const access: ResearchPacketAccess = { context: { teamId: 'team', model: 'claude-haiku-5-5', promptVersion: 'frozen-rubric', system: 'Frozen research policy', audience, selectionViewVersion: RESEARCH_SELECTION_VIEW_VERSION, selectionAudience: researchSelectionAudience(audience), schemaForItem: () => ({}) },
    model: 'claude-sonnet-5-5', outputTokens: 16384, now: () => clock,
    read: async id => values.has(id) ? copy(values.get(id)) : null,
    claim: async (id, value) => { if (values.has(id)) return false; values.set(id, copy(value)); return true; },
    save: async (id, expected, value) => { if (JSON.stringify(values.get(id)) !== JSON.stringify(expected)) return false; values.set(id, copy(value)); return true; },
    writeImmutable: async (id, value) => { if (!values.has(id)) values.set(id, copy(value)); }, generate,
  };
  return { access, values, generate, advance: (ms: number) => { clock += ms; } };
}
describe('durable source packet inference', () => {
  it('keeps real source identity and dates when registry watches point at an earlier archive capture', () => {
    const seed = (id: string, url: string): ResearchSourceSeed => ({ id, url, name: id, kind: 'web', category: 'practitioner', enabled: true, priority: 1, notes: '' });
    const primary = { ...seed('registered-primary', items[0].url), referencePacket: { id: definition.id, enabled: true, sourceIds: ['registered-reference'], relationship: definition.relationship } };
    const planned = configuredResearchPacketDefinitions([primary, seed('registered-reference', items[1].url)], items, ['primary'], ['registered-primary', 'registered-reference'], 4000);
    expect(planned.skipped).toEqual([]); expect(planned.definitions).toEqual([definition]);
    expect(researchPacketsFromDefinitions(planned.definitions, items)[0].sources[0]).toMatchObject({ id: 'primary', publishedAt: 1000, firstSeen: 2000 });
    expect(items[0].sourceId).toBe('archive-origin');
    expect(configuredResearchPacketDefinitions([{ ...primary, referencePacket: { ...primary.referencePacket, enabled: false } }], items, ['primary'], ['registered-primary'], 4000).definitions).toEqual([]);
    expect(configuredResearchPacketDefinitions([primary, seed('registered-reference', items[1].url)], items, ['primary'], ['registered-primary', 'registered-reference'], 2500).skipped).toHaveLength(1);
  });
  it('rejects absent, repeated or ungrounded packet members before any provider request', () => {
    expect(() => researchPacketsFromDefinitions([{ ...definition, sourceIds: ['primary', 'absent'] }], items)).toThrow('captured');
    expect(() => researchPacketsFromDefinitions([{ ...definition, sourceIds: ['primary', 'primary'] }], items)).toThrow('distinct');
    expect(() => researchPacketsFromDefinitions([definition], [items[0], { ...items[1], content: 'Short.' }])).toThrow('captured');
  });
  it('binds each document once, saves literal proofs and makes a completed resume use zero calls', async () => {
    const test = harness(), first = await reviewResearchSourcePackets([packet()], test.access);
    expect(first.acceptedIdeas).toHaveLength(1); expect(test.generate).toHaveBeenCalledTimes(1);
    const [request, maxTokens] = test.generate.mock.calls[0] as unknown as [{ data: { items: Record<string, unknown>[] } }, number];
    expect(maxTokens).toBe(16384); expect(request.data.items[0]).not.toHaveProperty('content'); expect(request.data.items[0]).toHaveProperty('reviewTransport', 'anthropic-tool-v1');
    expect(first.packetProofs[0].sources.map(source => source.sourceId)).toEqual(['primary', 'reference']);
    const resumed = await reviewResearchSourcePackets([packet()], test.access);
    expect(resumed).toEqual(first); expect(test.generate).toHaveBeenCalledTimes(1);
    const attemptId = [...test.values.keys()].find(id => id.startsWith('research-source-packet-attempt:'))!;
    const changed = structuredClone(test.values.get(attemptId)) as { raw: unknown }; changed.raw = { findings: {} }; test.values.set(attemptId, changed);
    await expect(reviewResearchSourcePackets([packet()], test.access)).rejects.toThrow('raw response changed'); expect(test.generate).toHaveBeenCalledTimes(1);
  });
  it('uses at most two new calls per checkpoint and reuses completed packets across batches', async () => {
    const inputs = [0, 1, 2].map(index => ({ ...packet(), id: 'packet-' + index }));
    const generate = vi.fn(async (request: { data: { items: Array<{ id: string }> } }) => response(inputs.find(packet => packet.id === request.data.items[0].id)!));
    const test = harness(generate as never);
    await expect(reviewResearchSourcePackets(inputs, { ...test.access, budget: { remaining: 2 } })).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(generate).toHaveBeenCalledTimes(2);
    const result = await reviewResearchSourcePackets(inputs, { ...test.access, budget: { remaining: 2 } });
    expect(result.acceptedIdeas).toHaveLength(3); expect(generate).toHaveBeenCalledTimes(3);
    expect((await reviewResearchSourcePackets(inputs, { ...test.access, budget: { remaining: 0 } })).manifestIds).toEqual(result.manifestIds);
  });
  it('does not retry terminal provider failures', async () => {
    const generate = vi.fn(async () => { throw Error('Provider refused the frozen request'); }), test = harness(generate as never);
    const result = await reviewResearchSourcePackets([packet()], test.access);
    expect(result.acceptedIdeas).toEqual([]); expect(result.diagnostics[0].reason).toContain('Provider refused');
    expect((await reviewResearchSourcePackets([packet()], test.access)).acceptedIdeas).toEqual([]); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('keeps default plan bytes and caches distinct from the optional coherent synthesis qualifier', async () => {
    const test = harness(), original = await reviewResearchSourcePackets([packet()], test.access);
    const v1Plan = [...test.values.values()].find((value: any) => value.packet && value.request) as any;
    expect(v1Plan.version).toBe('research-source-packet-v1'); expect(v1Plan).not.toHaveProperty('normalizerVersion');
    expect(v1Plan.request.data.items[0]).not.toHaveProperty('qualificationPolicyVersion');
    expect(await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy())).toEqual(original);
    expect(test.generate).toHaveBeenCalledTimes(1);
    const v2 = await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V2_REVIEW));
    expect(test.generate).toHaveBeenCalledTimes(2); expect(v2.qualificationPolicyVersion).toBe('research-source-packet-v2');
    expect(v2.packetProofs[0]).toMatchObject({ version: 'research-source-packet-v1', qualificationPolicyVersion: 'research-source-packet-v2', packetHash: original.packetProofs[0].packetHash });
    const v2Plan = [...test.values.values()].find((value: any) => value.packet && value.request && value.version === 'research-source-packet-v2') as any;
    expect(v2Plan.normalizerVersion).toBe('structured-inference-v2');expect(v2Plan.packetHash).toBe(v1Plan.packetHash);
    expect(await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V2_REVIEW))).toEqual(v2);
    expect(await reviewResearchSourcePackets([packet()], test.access)).toEqual(original);expect(test.generate).toHaveBeenCalledTimes(2);
    const previousPlans = [...test.values.entries()].filter(([id]) => id.startsWith('research-source-packet-plan:')).map(([id,value])=>[id,JSON.stringify(value)]);
    const v3Policy=researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V3_REVIEW);
    const v3=await reviewResearchSourcePackets([packet()],test.access,v3Policy);
    expect(test.generate).toHaveBeenCalledTimes(3);expect(v3.findings).toEqual(v2.findings);expect(v3.packetProofs).toEqual(v2.packetProofs);
    expect(v3.manifestIds).not.toEqual(v2.manifestIds);
    const v3Plan=[...test.values.values()].find((value:any)=>value.request?.instructions===v3Policy.instructions) as any;
    expect(v3Plan).toMatchObject({version:'research-source-packet-v2',normalizerVersion:'structured-inference-v2',packetHash:v1Plan.packetHash});
    for(const [id,value]of previousPlans)expect(JSON.stringify(test.values.get(id))).toBe(value);
    expect(await reviewResearchSourcePackets([packet()],test.access,v3Policy)).toEqual(v3);
    expect(await reviewResearchSourcePackets([packet()],test.access,researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V2_REVIEW))).toEqual(v2);
    expect(await reviewResearchSourcePackets([packet()],test.access)).toEqual(original);expect(test.generate).toHaveBeenCalledTimes(3);
  });
  it('preserves frozen v1/v2 prompt and contract hashes while v3 reuses exactly the v2 protocol', async()=>{
    const v1=researchSourcePacketPolicy(),v2=researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V2_REVIEW),v3=researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V3_REVIEW);
    expect(await researchHash(v1.instructions)).toBe('55bdc84f8af507dcf87d34b57c859b465e0e25503ad10740c18d9bb33fc7c172');
    expect(await researchHash(v2.instructions)).toBe('5b2ef7056250b9d409e40378657dfdbcd67a02b76e119b8f6b289296889c9079');
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V2_REVIEW,16384)))).toBe('b2b30673aa56d9e473871e0cf10b8f423c7c9abd6c1e29d8e6b744231e5d537e');
    expect(v3.normalize).toBe(v2.normalize);expect(v3.schema).toBe(v2.schema);expect(v3.metadata).toBe(v2.metadata);
    expect(v3.version).toBe(v2.version);expect(v3.qualificationPolicyVersion).toBe(v2.qualificationPolicyVersion);expect(v3.normalizerVersion).toBe(v2.normalizerVersion);
    expect(v3.instructions).not.toBe(v2.instructions);expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V3_REVIEW,16384)).not.toEqual(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V2_REVIEW,16384));
    expect(()=>researchSourcePacketPolicy('unrecognized-packet-policy')).toThrow('Unknown source packet review policy');
    expect(await researchHash(v3.instructions)).toBe('c191704d9f6486f0132f443de750e1e734fca9cbf386c769957235d2a895447f');
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V3_REVIEW,16384)))).toBe('6225b4dbd7e08cc780e2bf62af3e68164185e8fba8938e208f4f5df044746eca');
  });
  it('binds opt-in v4 prompt and empty-note normalizer to a new cache while keeping v1/v2/v3 reusable', async () => {
    const test = harness(), policies = [undefined, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW].map(researchSourcePacketPolicy);
    const previous = [];
    for (const policy of policies) previous.push(await reviewResearchSourcePackets([packet()], test.access, policy));
    const oldRecords = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    const policy = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW);
    const next = await reviewResearchSourcePackets([packet()], test.access, policy);
    expect(test.generate).toHaveBeenCalledTimes(4);
    expect(policy.normalizerVersion).toBe('structured-inference-v2+empty-content-angle-note-v1');
    expect(await researchHash(policy.instructions)).toBe('54aaf1a1b678e66987b4ec013d77df1e9fad782c8af7ba16c1d6e9b51b48f17e');
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V4_REVIEW, 16384)))).toBe('694ffac902650028b6a12b062d9b34ade2adb9114933c37d1809d4d2d0c124a6');
    expect(policy.qualificationPolicyVersion).toBe('research-source-packet-v2');
    expect(next.findings).toEqual(previous[2].findings); expect(next.packetProofs).toEqual(previous[2].packetProofs);
    expect(next.manifestIds).not.toEqual(previous[2].manifestIds);
    for (const [id, value] of oldRecords) expect(JSON.stringify(test.values.get(id))).toBe(value);
    expect(await reviewResearchSourcePackets([packet()], test.access, policy)).toEqual(next);
    for (const [index, old] of policies.entries()) expect(await reviewResearchSourcePackets([packet()], test.access, old)).toEqual(previous[index]);
    expect(test.generate).toHaveBeenCalledTimes(4);
  });
  it('v6 adds only a general extraction check while preserving every earlier contract and the v5 parser', async () => {
    const v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW), v6 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V6_REVIEW);
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V5_REVIEW, 16384)))).toBe('ae705c5063e8bf8731866fcab4f4376317100e956b7ebed6f8533a778bffafc3');
    expect(v6.instructions.startsWith(v5.instructions + '\n\n')).toBe(true);
    const added = v6.instructions.slice(v5.instructions.length + 2);
    expect(added.split('\n')).toHaveLength(1);
    expect(added).toContain('do not leave a necessary link only in evidence');
    expect(added).toContain('necessary product or mode conditions');
    expect(added).not.toMatch(/google|search|benchmark|creative|pricing/i);
    expect(v6.normalize).toBe(v5.normalize); expect(v6.schema).toBe(v5.schema); expect(v6.metadata).toBe(v5.metadata);
    expect(v6.normalizerVersion).toBe(v5.normalizerVersion); expect(v6.qualificationPolicyVersion).toBe(v5.qualificationPolicyVersion);
    expect(v5.reuseCompletedV4).toBe(true); expect(v6.reuseCompletedV4).toBeUndefined();
    expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V6_REVIEW, 16384)).toEqual({
      ...researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V5_REVIEW, 16384), reviewVersion: RESEARCH_SOURCE_PACKET_V6_REVIEW, instructions: v6.instructions,
    });
    const original = response(packet()), raw = response(packet()); raw.findings.workflow.claim.summary = original.findings.workflow.claim.summary.repeat(100);
    Object.assign(raw.findings.workflow.claim, { empty_note: '' });
    const result = await v6.normalize(raw, [packet()], ['personal']);
    expect(result.findings[0].summary).toBe(raw.findings.workflow.claim.summary); expect(result.findings[0].score).toBe(92);
    for (const changed of [{ sourceSupport: 'unsupported' }, { usefulDecision: 'generic' }, { scopeHonesty: 'material_gap' }]) {
      const failed = structuredClone(raw); Object.assign(failed.findings.workflow.qualityComponents, changed);
      expect((await v6.normalize(failed, [packet()], ['personal'])).findings[0].score).toBeLessThan(70);
    }
    const unknown = structuredClone(raw); Object.assign(unknown.findings.workflow.claim, { note: 'meaningful text' });
    expect((await v6.normalize(unknown, [packet()], ['personal'])).findings).toEqual([]);
  });
  it('v6 stays cold beside authentic v4/v5 receipts, performs its own request once and cannot derive from them', async () => {
    const test = harness(), v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW), v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW), v6 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V6_REVIEW);
    const oldV4 = await reviewResearchSourcePackets([packet()], test.access, v4);
    const oldV5 = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v5);
    const previous = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v6)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(1);
    const next = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, v6);
    expect(test.generate).toHaveBeenCalledTimes(2); expect(next.acceptedIdeas).toHaveLength(1);
    const [oldRequest] = test.generate.mock.calls[0] as unknown as [{ instructions: string; schema: unknown; data: unknown }];
    const [newRequest] = test.generate.mock.calls[1] as unknown as [typeof oldRequest];
    expect(newRequest.instructions).toBe(v6.instructions); expect(newRequest.instructions).not.toBe(oldRequest.instructions);
    expect(newRequest.schema).toEqual(oldRequest.schema); expect(newRequest.data).toEqual(oldRequest.data);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v6)).toEqual(next);
    expect(await reviewResearchSourcePackets([packet()], test.access, v4)).toEqual(oldV4);
    expect(await reviewResearchSourcePackets([packet()], test.access, v5)).toEqual(oldV5);
    for (const [id, bytes] of previous) expect(JSON.stringify(test.values.get(id))).toBe(bytes);
    const plan = [...test.values.values()].find((value: any) => value.request?.instructions === v6.instructions) as any;
    const id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    expect(attempt).not.toHaveProperty('normalizationOnly'); expect(attempt).not.toHaveProperty('reusedFrom');
    expect([...test.values.keys()].filter(id => id.startsWith('research-source-packet-normalization:'))).toHaveLength(1);
    test.values.set(id, { ...attempt, normalizationOnly: true, reusedFrom: {} });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v6)).rejects.toThrow('authentic parent');
    expect(test.generate).toHaveBeenCalledTimes(2);
  });
  it('expires an in-flight claim without repeating inference and keeps its terminal state against a late response', async () => {
    let resolve!: (value: unknown) => void, entered!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    const generate = vi.fn(async () => { entered(); return new Promise<unknown>(done => { resolve = done; }); }), test = harness(generate as never);
    const first = reviewResearchSourcePackets([packet()], test.access); await started;
    const pending = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 2 } }).catch(error => error);
    expect(pending).toBeInstanceOf(ResearchSourcePacketPending); expect(generate).toHaveBeenCalledTimes(1);
    test.advance(120001);
    const expired = await reviewResearchSourcePackets([packet()], test.access);
    expect(expired.acceptedIdeas).toEqual([]); expect(expired.diagnostics[0].reason).toContain('indeterminate');
    resolve(response(packet())); expect((await first).acceptedIdeas).toEqual([]); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('v5 reuses an authenticated completed v4 raw receipt at zero budget and preserves all old bytes', async () => {
    const raw = response(packet()); Object.assign(raw.findings.workflow.claim, { summary_note: '' });
    Object.assign(raw.findings.workflow, { claim_note: null });
    const test = harness(vi.fn(async () => raw)), v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW);
    const old = await reviewResearchSourcePackets([packet()], test.access, v4); expect(old.acceptedIdeas).toEqual([]);
    const before = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]), v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW);
    expect(v5.normalizerVersion).toBe('structured-inference-v2+empty-unknown-frame-claim-fields-v1+complete-claim-text-v1');
    expect(v5.instructions).toBe(v4.instructions); expect(v5.schema).toBe(v4.schema); expect(v5.metadata).toBe(v4.metadata);
    const next = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v5);
    expect(next.acceptedIdeas).toHaveLength(1); expect(test.generate).toHaveBeenCalledTimes(1);
    const attempt = [...test.values.values()].find((v: any) => v.normalizationOnly) as any;
    expect(attempt).toMatchObject({ normalizationOnly: true, state: 'completed', raw });
    expect(attempt.reusedFrom).toMatchObject({ rawHash: attempt.rawHash, normalizerVersion: v4.normalizerVersion });
    expect(attempt.removedPaths).toEqual(['/findings/workflow/claim_note', '/findings/workflow/claim/summary_note']);
    const parent = test.values.get(attempt.reusedFrom.attemptId) as any;
    expect(attempt.reusedFrom.attemptHash).toBe(await researchHash(JSON.stringify(parent)));
    expect(attempt.reusedFrom.resultHash).toBe(parent.resultHash);
    for (const [id, value] of before) expect(JSON.stringify(test.values.get(id))).toBe(value);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v5)).toEqual(next);
    expect(await reviewResearchSourcePackets([packet()], test.access, v4)).toEqual(old); expect(test.generate).toHaveBeenCalledTimes(1);
    const id = [...test.values].find(([, value]: any) => value.normalizationOnly)![0];
    test.values.set(id, { ...attempt, removedPaths: [] });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v5)).rejects.toThrow('authentic parent');
  });
  it('v5 authenticates all eight unchanged v4 parents and preserves long raw claims through zero-call resume', async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => ({ ...packet(), id: 'packet-' + index }));
    const generate = vi.fn(async (request: { data: { items: Array<{ id: string }> } }) => {
      const raw = response(inputs.find(input => input.id === request.data.items[0].id)!);
      const claim = raw.findings[request.data.items[0].id].claim;
      for (const field of ['summary', 'contentAngle', 'whyItMatters', 'limitations'] as const) claim[field] = claim[field].repeat(100);
      return raw;
    });
    const test = harness(generate as never), v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW);
    for (let checkpoint = 0; checkpoint < 3; checkpoint++)
      await expect(reviewResearchSourcePackets(inputs, { ...test.access, budget: { remaining: 2 } }, v4)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    const old = await reviewResearchSourcePackets(inputs, { ...test.access, budget: { remaining: 2 } }, v4);
    expect(old.acceptedIdeas).toEqual([]); expect(generate).toHaveBeenCalledTimes(8);
    const parents = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    const v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW), access = { ...test.access, budget: { remaining: 0 } };
    const result = await reviewResearchSourcePackets(inputs, access, v5);
    expect(result.acceptedIdeas).toHaveLength(8);
    expect([...test.values.values()].filter((value: any) => value.normalizationOnly)).toHaveLength(8);
    for (const [index, finding] of result.acceptedIdeas.entries()) {
      const original = response(inputs[index]).findings[inputs[index].id];
      for (const field of ['summary', 'contentAngle', 'whyItMatters', 'limitations'] as const) expect(finding[field]).toBe(original.claim[field].repeat(100));
      expect(finding.score).toBe(92);
    }
    expect(await reviewResearchSourcePackets(inputs, access, v5)).toEqual(result);
    expect(await reviewResearchSourcePackets(inputs, access, v4)).toEqual(old);
    for (const [id, bytes] of parents) expect(JSON.stringify(test.values.get(id))).toBe(bytes);
    expect(generate).toHaveBeenCalledTimes(8);
  });
  it.each(['plan', 'raw', 'result', 'manifest', 'source'])('v5 rejects changed authentic parent %s without a provider call', async mutation => {
    const test = harness(), v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW);
    await reviewResearchSourcePackets([packet()], test.access, v4);
    const [id, original] = [...test.values].find(([id]) => id.startsWith(mutation === 'plan' || mutation === 'source' ? 'research-source-packet-plan:' : mutation === 'manifest' ? 'research-source-packet-manifest:' : 'research-source-packet-attempt:'))!;
    const changed = structuredClone(original) as any;
    if (mutation === 'plan') changed.request.instructions += ' changed';
    if (mutation === 'source') changed.packet.sources[0].content += ' changed';
    if (mutation === 'raw') changed.raw.findings.workflow.claim.summary += ' changed';
    if (mutation === 'result') changed.resultHash = 'changed';
    if (mutation === 'manifest') changed.result.findings = [];
    test.values.set(id, changed);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW))).rejects.toThrow('normalization parent');
    expect(test.generate).toHaveBeenCalledTimes(1);
  });
  it('v5 stays cold for a different body/audience/output budget and only makes a fresh call when budget permits', async () => {
    const test = harness(); await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW));
    const v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW);
    const changedBody = packet(); changedBody.sources[0].content += ' A new documented observation.';
    for (const [input, access] of [[changedBody, test.access], [packet(), { ...test.access, outputTokens: 17000 }],
      [packet(), { ...test.access, context: { ...test.access.context, audience: { ...audience, icp: 'A different frozen audience.' } } }]] as const) {
      await expect(reviewResearchSourcePackets([input], { ...access, budget: { remaining: 0 } }, v5)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    }
    expect(test.generate).toHaveBeenCalledTimes(1);
    const cold = harness(), result = await reviewResearchSourcePackets([packet()], { ...cold.access, budget: { remaining: 1 } }, v5);
    expect(result.acceptedIdeas).toHaveLength(1); expect(cold.generate).toHaveBeenCalledTimes(1);
    expect([...cold.values.values()].some((v: any) => v.normalizationOnly)).toBe(false);
  });

});
