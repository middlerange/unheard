import { describe, expect, it, vi } from 'vitest';
import { parseResearchAudience } from './research-audience';
import { researchSelectionAudience, RESEARCH_SELECTION_VIEW_VERSION } from './research-selection-audience';
import { researchPacketsFromDefinitions, configuredResearchPacketDefinitions, reviewResearchSourcePackets, researchSourcePacketPolicy, researchSourcePacketPolicyContract, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW, RESEARCH_SOURCE_PACKET_V7_REVIEW, RESEARCH_SOURCE_PACKET_V8_REVIEW, RESEARCH_SOURCE_PACKET_V9_REVIEW, RESEARCH_SOURCE_PACKET_V9_STRICT_REVIEW, RESEARCH_SOURCE_PACKET_V9_RELATIONSHIP_REVIEW, ResearchSourcePacketPending, type ResearchPacketAccess } from './research-source-packets';
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
  it('v7 appends one generic decision check to v4 while retaining v5 gates and all previous contracts', async () => {
    const v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW), v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW), v7 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V7_REVIEW);
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V6_REVIEW, 16384)))).toBe('531862e78069ceec9088b8a3db53ed6b61801f5b726f70a9d06194fdb2c7f516');
    expect(v7.instructions.startsWith(v4.instructions + '\n\n')).toBe(true);
    const added = v7.instructions.slice(v4.instructions.length + 2);
    expect(added.split('\n')).toHaveLength(1);
    expect(added).toContain('both the comparison and the method');
    expect(added).toContain('all material steps, conditions, attribution and uncertainty');
    expect(added).toContain('Do not force unrelated comparisons together');
    expect(added).not.toMatch(/katelyn|authority|buyers|engagement|4p|google|benchmark/i);
    expect(v7.schema).toBe(v5.schema); expect(v7.metadata).toBe(v5.metadata); expect(v7.normalize).toBe(v5.normalize);
    expect(v7.reuseCompletedV4).toBeUndefined();
    expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V7_REVIEW, 16384)).toEqual({
      ...researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V5_REVIEW, 16384), reviewVersion: RESEARCH_SOURCE_PACKET_V7_REVIEW, instructions: v7.instructions,
    });
    const raw = response(packet()); raw.findings.workflow.claim.summary = raw.findings.workflow.claim.summary.repeat(100);
    Object.assign(raw.findings.workflow.claim, { empty_note: '' });
    const result = await v7.normalize(raw, [packet()], ['personal']);
    expect(result).toEqual(await v5.normalize(raw, [packet()], ['personal']));
    expect(result.findings[0].summary).toBe(raw.findings.workflow.claim.summary); expect(result.findings[0].score).toBe(92);
    for (const changed of [{ sourceSupport: 'unsupported' }, { usefulDecision: 'generic' }, { scopeHonesty: 'material_gap' }]) {
      const failed = structuredClone(raw); Object.assign(failed.findings.workflow.qualityComponents, changed);
      expect((await v7.normalize(failed, [packet()], ['personal'])).findings[0].score).toBeLessThan(70);
    }
    const wrongProfile = structuredClone(raw); wrongProfile.findings.workflow.profileChecks[0].profileId = 'unknown';
    expect((await v7.normalize(wrongProfile, [packet()], ['personal'])).findings).toEqual([]);
    const unknown = structuredClone(raw); Object.assign(unknown.findings.workflow.claim, { note: 'meaningful text' });
    expect((await v7.normalize(unknown, [packet()], ['personal'])).findings).toEqual([]);
  });
  it('v7 requires its own fresh request beside every earlier policy and resumes only its own immutable receipt', async () => {
    const test = harness(), versions = [undefined, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW];
    const earlier = [];
    for (const version of versions) earlier.push(await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(version)));
    expect(test.generate).toHaveBeenCalledTimes(5);
    const previous = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]), v7 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V7_REVIEW);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v7)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(5);
    const next = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, v7);
    expect(test.generate).toHaveBeenCalledTimes(6); expect(next.acceptedIdeas).toHaveLength(1);
    const [oldRequest] = test.generate.mock.calls[3] as unknown as [{ instructions: string; schema: unknown; data: unknown }];
    const [newRequest] = test.generate.mock.calls[5] as unknown as [typeof oldRequest];
    expect(newRequest.instructions).toBe(v7.instructions); expect(newRequest.instructions).not.toBe(oldRequest.instructions);
    expect(newRequest.schema).toEqual(oldRequest.schema); expect(newRequest.data).toEqual(oldRequest.data);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v7)).toEqual(next);
    for (const [index, version] of versions.entries()) expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, researchSourcePacketPolicy(version))).toEqual(earlier[index]);
    for (const [id, bytes] of previous) expect(JSON.stringify(test.values.get(id))).toBe(bytes);
    const plan = [...test.values.values()].find((value: any) => value.request?.instructions === v7.instructions) as any;
    const id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    expect(attempt).not.toHaveProperty('normalizationOnly'); expect(attempt).not.toHaveProperty('reusedFrom');
    expect([...test.values.keys()].filter(id => id.startsWith('research-source-packet-normalization:'))).toHaveLength(1);
    test.values.set(id, { ...attempt, normalizationOnly: true, reusedFrom: {} });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v7)).rejects.toThrow('authentic parent');
    expect(test.generate).toHaveBeenCalledTimes(6);
  });
  it('v8 replaces source-priority hierarchy while preserving v7 completeness and every V1–V7 contract', async () => {
    const v4 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V4_REVIEW), v5 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW), v7 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V7_REVIEW), v8 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V8_REVIEW);
    expect(await researchHash(v7.instructions)).toBe('31aba2d6b0e97f1d518e61d4c50bdcc2f783b961b6f9bfa8161acd7e6b00aefa');
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V7_REVIEW, 16384)))).toBe('e2e0686e26b3ae40b83a001341ce7a082261e411070dd11ce3c08a1627615264');
    const previous = v4.instructions.split('\n\n'), next = v8.instructions.split('\n\n');
    expect(next[2]).toBe(previous[2]); expect(next.slice(4, -1)).toEqual(previous.slice(4));
    expect(next.at(-1)).toBe(v7.instructions.slice(v4.instructions.length + 2));
    expect(next[1]).toContain('does not set editorial priority');
    expect(next[1]).toContain('regardless of source order, paragraph position, format or commercial ownership');
    expect(next[3]).toContain('different reader triggers duplicates');
    expect(next[3]).toContain('do not discard the context or leave it only in citations');
    expect(v8.instructions).not.toMatch(/complete coherent main reader story|Then inspect|subsidiary assurance|marketing comparison/);
    expect([next[0], next[1], next[3], next.at(-1)].join(' ')).not.toMatch(/katelyn|unignorable|fyxer|ryze|moccia|google|buyer|engagement|4p|benchmark/i);
    expect(v8.schema).toBe(v5.schema); expect(v8.metadata).toBe(v5.metadata); expect(v8.normalize).toBe(v5.normalize); expect(v8.normalizerVersion).toBe(v5.normalizerVersion);
    expect(v8.reuseCompletedV4).toBeUndefined();
    expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V8_REVIEW, 16384)).toEqual({ ...researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V5_REVIEW, 16384), reviewVersion: RESEARCH_SOURCE_PACKET_V8_REVIEW, instructions: v8.instructions });
    const raw = response(packet()); raw.findings.workflow.claim.summary = raw.findings.workflow.claim.summary.repeat(100); Object.assign(raw.findings.workflow.claim, { empty_note: '' });
    expect(await v8.normalize(raw, [packet()], ['personal'])).toEqual(await v5.normalize(raw, [packet()], ['personal']));
    for (const changed of [{ sourceSupport: 'unsupported' }, { usefulDecision: 'generic' }, { scopeHonesty: 'material_gap' }]) {
      const failed = structuredClone(raw); Object.assign(failed.findings.workflow.qualityComponents, changed);
      expect((await v8.normalize(failed, [packet()], ['personal'])).findings[0].score).toBeLessThan(70);
    }
    const bridge = structuredClone(raw); bridge.findings.workflow.relationshipSupport = 'unsupported_bridge'; expect((await v8.normalize(bridge, [packet()], ['personal'])).findings).toEqual([]);
    const unknown = structuredClone(raw); Object.assign(unknown.findings.workflow.claim, { note: 'nonempty' }); expect((await v8.normalize(unknown, [packet()], ['personal'])).findings).toEqual([]);
  });
  it('v8 requires its own fresh request beside every earlier policy and resumes only its own immutable receipt', async () => {
    const test = harness(), versions = [undefined, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW, RESEARCH_SOURCE_PACKET_V7_REVIEW];
    const earlier = [];
    for (const version of versions) earlier.push(await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(version)));
    expect(test.generate).toHaveBeenCalledTimes(6);
    const previous = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]), v8 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V8_REVIEW);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v8)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(6);
    const next = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, v8);
    expect(test.generate).toHaveBeenCalledTimes(7); expect(next.acceptedIdeas).toHaveLength(1);
    const [oldRequest] = test.generate.mock.calls[3] as unknown as [{ instructions: string; schema: unknown; data: unknown }];
    const [newRequest] = test.generate.mock.calls[6] as unknown as [typeof oldRequest];
    expect(newRequest.instructions).toBe(v8.instructions); expect(newRequest.instructions).not.toBe(oldRequest.instructions);
    expect(newRequest.schema).toEqual(oldRequest.schema); expect(newRequest.data).toEqual(oldRequest.data);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v8)).toEqual(next);
    for (const [index, version] of versions.entries()) expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, researchSourcePacketPolicy(version))).toEqual(earlier[index]);
    for (const [id, bytes] of previous) expect(JSON.stringify(test.values.get(id))).toBe(bytes);
    const plan = [...test.values.values()].find((value: any) => value.request?.instructions === v8.instructions) as any;
    const id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    expect(attempt).not.toHaveProperty('normalizationOnly'); expect(attempt).not.toHaveProperty('reusedFrom');
    expect([...test.values.keys()].filter(id => id.startsWith('research-source-packet-normalization:'))).toHaveLength(1);
    test.values.set(id, { ...attempt, normalizationOnly: true, reusedFrom: {} });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v8)).rejects.toThrow('authentic parent');
    expect(test.generate).toHaveBeenCalledTimes(7);
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

describe('opt-in structured reader decision packet receipts', () => {
  it('pins every old contract and leaves the default unchanged', async () => {
    const hashes = [
      [RESEARCH_SOURCE_PACKET_V2_REVIEW, 'b2b30673aa56d9e473871e0cf10b8f423c7c9abd6c1e29d8e6b744231e5d537e'],
      [RESEARCH_SOURCE_PACKET_V3_REVIEW, '6225b4dbd7e08cc780e2bf62af3e68164185e8fba8938e208f4f5df044746eca'],
      [RESEARCH_SOURCE_PACKET_V4_REVIEW, '694ffac902650028b6a12b062d9b34ade2adb9114933c37d1809d4d2d0c124a6'],
      [RESEARCH_SOURCE_PACKET_V5_REVIEW, 'ae705c5063e8bf8731866fcab4f4376317100e956b7ebed6f8533a778bffafc3'],
      [RESEARCH_SOURCE_PACKET_V6_REVIEW, '531862e78069ceec9088b8a3db53ed6b61801f5b726f70a9d06194fdb2c7f516'],
      [RESEARCH_SOURCE_PACKET_V7_REVIEW, 'e2e0686e26b3ae40b83a001341ce7a082261e411070dd11ce3c08a1627615264'],
      [RESEARCH_SOURCE_PACKET_V8_REVIEW, 'ae6144e7c5a5e18abe142b06b9031f71736263cd36ae63a2fb87c1184ffb9351'],
    ];
    for (const [version, expected] of hashes) expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(version, 16384)))).toBe(expected);
    expect(await researchHash(researchSourcePacketPolicy().instructions)).toBe('55bdc84f8af507dcf87d34b57c859b465e0e25503ad10740c18d9bb33fc7c172');
    const v9 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW), old = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V5_REVIEW);
    expect(v9.metadata).toBe(old.metadata); expect(v9.reuseCompletedV4).toBeUndefined(); expect(v9.normalizerVersion).not.toBe(old.normalizerVersion);
    expect(v9.instructions).toContain('When the answer proposes evaluating a benefit');
    expect(v9.instructions).toContain('Informative findings and applications do not require an invented experiment');
    expect(v9.instructions).not.toMatch(/fyxer|katelyn|google|engagement|buyer|benchmark|4p/i);
    expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V9_REVIEW, 16384)).toMatchObject({ model: 'claude-sonnet-5-5', outputTokens: 16384, scoreThreshold: 70, rubric: 'source_qualification_v1' });
  });
  it('requires fresh structured raw, binds rendered result hashes, and resumes without changing older caches', async () => {
    const v9 = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW);
    const generate = vi.fn(async (request: { instructions: string }) => {
      const raw: any = response(packet());
      if (request.instructions === v9.instructions) raw.findings.workflow.claim = {
        readerDecision: { mode: 'application', question: 'Where is approval required?', answer: 'Inspect the documented approval handoff.' },
        factualCore: { kind: 'mechanism', input: 'Account context.', action: 'Create a draft.', output: 'Draft for review.', conditions: 'Human approval.' },
        whyItMatters: 'The permission boundary is explicit.', limitations: 'A documented capability, not a measured outcome.',
      };
      return raw;
    });
    const test = harness(generate as never), versions = [undefined, RESEARCH_SOURCE_PACKET_V2_REVIEW, RESEARCH_SOURCE_PACKET_V3_REVIEW, RESEARCH_SOURCE_PACKET_V4_REVIEW, RESEARCH_SOURCE_PACKET_V5_REVIEW, RESEARCH_SOURCE_PACKET_V6_REVIEW, RESEARCH_SOURCE_PACKET_V7_REVIEW, RESEARCH_SOURCE_PACKET_V8_REVIEW];
    const earlier = [];
    for (const version of versions) earlier.push(await reviewResearchSourcePackets([packet()], test.access, researchSourcePacketPolicy(version)));
    expect(generate).toHaveBeenCalledTimes(7);
    const previous = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v9)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(generate).toHaveBeenCalledTimes(7);
    const result = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, v9);
    expect(result.acceptedIdeas).toHaveLength(1); expect(generate).toHaveBeenCalledTimes(8);
    expect(result.acceptedIdeas[0].contentAngle).toBe('Reader question: Where is approval required?\nAnswer (application): Inspect the documented approval handoff.');
    const plan = [...test.values.values()].find((value: any) => value.request?.instructions === v9.instructions) as any;
    const oldPlan = [...test.values.values()].find((value: any) => value.request?.instructions === researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V8_REVIEW).instructions) as any;
    expect(plan.packet).toEqual(oldPlan.packet); expect(plan.audience).toEqual(oldPlan.audience); expect(plan.request.data).toEqual(oldPlan.request.data); expect(plan.request.schema).not.toEqual(oldPlan.request.schema);
    const id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    expect(attempt.rawHash).toBe(await researchHash(JSON.stringify(attempt.raw)));
    expect(attempt.resultHash).toBe(await researchHash(stable(await v9.normalize(attempt.raw, [packet()], ['personal']))));
    expect(attempt.raw.findings.workflow.claim).not.toHaveProperty('summary'); expect(attempt.raw.findings.workflow.claim).not.toHaveProperty('contentAngle');
    expect(attempt).not.toHaveProperty('normalizationOnly'); expect(attempt).not.toHaveProperty('reusedFrom');
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v9)).toEqual(result);
    for (const [index, version] of versions.entries()) expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, researchSourcePacketPolicy(version))).toEqual(earlier[index]);
    for (const [key, bytes] of previous) expect(JSON.stringify(test.values.get(key))).toBe(bytes);
    test.values.set(id, { ...attempt, raw: { findings: {} } });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v9)).rejects.toThrow('raw response changed');
    test.values.set(id, { ...attempt, resultHash: 'tampered' });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v9)).rejects.toThrow('normalized response changed');
    test.values.set(id, { ...attempt, normalizationOnly: true, reusedFrom: {} });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, v9)).rejects.toThrow('authentic parent');
    expect(generate).toHaveBeenCalledTimes(8);
  });
});

describe('V9 strict tool variant', () => {
  it('retains the used V9 contract and normalizer while explicitly pinning strict transport and compiler', async () => {
    const old = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW), strict = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_STRICT_REVIEW);
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V9_REVIEW, 16384)))).toBe('cab5015d5ada5ad6a3524e4e43ba1ae263f7ce56d5ab7c6f7f0d97e857956d4e');
    expect(strict.instructions).toBe(old.instructions); expect(strict.normalize).toBe(old.normalize); expect(strict.metadata).toBe(old.metadata); expect(strict.normalizerVersion).toBe(old.normalizerVersion);
    expect(old.reviewTransport).toBeUndefined(); expect(old.schemaCompilerVersion).toBeUndefined(); expect(strict.reuseCompletedV4).toBeUndefined();
    expect(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V9_STRICT_REVIEW, 16384)).toMatchObject({ reviewTransport: 'anthropic-strict-tool-v1', schemaCompilerVersion: 'anthropic-strict-tool-schema-v1', scoreThreshold: 70, rubric: 'source_qualification_v1' });
    const malformed = { findings: JSON.stringify(response(packet()).findings) };
    expect((await strict.normalize(malformed, [packet()], ['personal'])).findings).toEqual([]);
  });
  it('owns a fresh receipt, retains old raw, pins compiler identity in the plan and authenticates only its own zero-call resume', async () => {
    const raw: any = response(packet()); raw.findings.workflow.claim = {
      readerDecision: { mode: 'informative', question: 'What approval boundary is documented?', answer: 'Human approval precedes changes.' },
      factualCore: { kind: 'observation', observation: 'The publisher describes a human approval boundary.' },
      whyItMatters: 'A bounded permission decision.', limitations: 'A documented capability, not measured effectiveness.',
    };
    const test = harness(vi.fn(async () => structuredClone(raw))), old = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW), strict = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_STRICT_REVIEW);
    const original = await reviewResearchSourcePackets([packet()], test.access, old), oldBytes = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, strict)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(1);
    const result = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, strict);
    expect(result.acceptedIdeas).toEqual(original.acceptedIdeas); expect(result.manifestIds).not.toEqual(original.manifestIds); expect(test.generate).toHaveBeenCalledTimes(2);
    const plan = [...test.values.values()].find((value: any) => value.schemaCompilerVersion) as any;
    expect(plan.schemaCompilerVersion).toBe('anthropic-strict-tool-schema-v1'); expect(plan.request.data.items[0].reviewTransport).toBe('anthropic-strict-tool-v1');
    expect(JSON.stringify(plan.request.schema)).not.toContain('"oneOf":');
    const id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    expect(attempt.raw).toEqual(raw); expect(attempt.rawHash).toBe(await researchHash(JSON.stringify(raw))); expect(attempt).not.toHaveProperty('normalizationOnly');
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, strict)).toEqual(result);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, old)).toEqual(original);
    for (const [key, bytes] of oldBytes) expect(JSON.stringify(test.values.get(key))).toBe(bytes);
    const differentCompiler = { ...strict, schemaCompilerVersion: 'future-compiler' } as unknown as typeof strict;
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, differentCompiler)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(2);
    const outOfRange = structuredClone(raw); outOfRange.findings.workflow.profileChecks[0].relevance = 99;
    expect((await strict.normalize(outOfRange, [packet()], ['personal'])).findings).toEqual([]);
    const badQuote = structuredClone(raw); badQuote.findings.workflow.evidenceCitations[0].passageIds = [-1];
    expect((await strict.normalize(badQuote, [packet()], ['personal'])).findings).toEqual([]);
    for (const changed of [{ sourceSupport: 'unsupported' }, { usefulDecision: 'generic' }, { scopeHonesty: 'material_gap' }]) {
      const failed = structuredClone(raw); Object.assign(failed.findings.workflow.qualityComponents, changed);
      expect((await strict.normalize(failed, [packet()], ['personal'])).findings[0].score).toBeLessThan(70);
    }
  });
});

describe('relationship-aware V9 rendering policy', () => {
  it('retains old V9 and strict contracts and uses the exact V9 wire with a fresh normalizer', async () => {
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V9_REVIEW, 16384)))).toBe('cab5015d5ada5ad6a3524e4e43ba1ae263f7ce56d5ab7c6f7f0d97e857956d4e');
    expect(await researchHash(JSON.stringify(researchSourcePacketPolicyContract(RESEARCH_SOURCE_PACKET_V9_STRICT_REVIEW, 16384)))).toBe('c152cc61940b60a86850545f54831965e93e908d06ea1e8cd0ef896e9397bf97');
    const original = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW), next = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_RELATIONSHIP_REVIEW);
    expect(next.instructions).toBe(original.instructions); expect(next.schema).toBe(original.schema); expect(next.metadata).toBe(original.metadata);
    expect(next.normalizerVersion).not.toBe(original.normalizerVersion); expect(next.reuseCompletedV4).toBeUndefined(); expect(next.reviewTransport).toBeUndefined();
  });
  it('does not reinterpret an old raw receipt and reuses only its own authenticated rendered result', async () => {
    const raw: any = response(packet()); raw.findings.workflow.relationshipSupport = 'bounded_inference';
    raw.findings.workflow.relationshipExplanation = 'Our editorial inference connects these documented approval and draft actions; no outcome is observed.';
    raw.findings.workflow.claim = { readerDecision: { mode: 'informative', question: 'What boundary is documented?', answer: 'Human approval precedes changes.' },
      factualCore: { kind: 'observation', observation: 'The publisher describes an approval boundary.' },
      whyItMatters: 'A useful permission decision.', limitations: 'Publisher descriptions, not measured results.' };
    const test = harness(vi.fn(async () => structuredClone(raw))), old = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_REVIEW), next = researchSourcePacketPolicy(RESEARCH_SOURCE_PACKET_V9_RELATIONSHIP_REVIEW);
    const original = await reviewResearchSourcePackets([packet()], test.access, old);
    expect(original.acceptedIdeas).toEqual([]); const frozen = [...test.values].map(([id, value]) => [id, JSON.stringify(value)]);
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, next)).rejects.toBeInstanceOf(ResearchSourcePacketPending);
    expect(test.generate).toHaveBeenCalledTimes(1);
    const result = await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 1 } }, next);
    expect(result.acceptedIdeas).toHaveLength(1); expect(test.generate).toHaveBeenCalledTimes(2);
    expect(result.acceptedIdeas[0].limitations).toContain(raw.findings.workflow.relationshipExplanation);
    const plans = [...test.values.values()].filter((value: any) => value.request) as any[];
    expect(plans[0].request).toEqual(plans[1].request); expect(plans[0].packet).toEqual(plans[1].packet);
    const plan = plans.find(value => value.normalizerVersion === next.normalizerVersion), id = 'research-source-packet-attempt:v1:' + await researchHash(JSON.stringify(plan)), attempt = test.values.get(id) as any;
    expect(attempt.raw).toEqual(raw); expect(attempt.rawHash).toBe(await researchHash(JSON.stringify(raw))); expect(attempt).not.toHaveProperty('normalizationOnly'); expect(attempt).not.toHaveProperty('reusedFrom');
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, next)).toEqual(result);
    expect(await reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, old)).toEqual(original);
    for (const [key, bytes] of frozen) expect(JSON.stringify(test.values.get(key))).toBe(bytes);
    test.values.set(id, { ...attempt, resultHash: 'changed' });
    await expect(reviewResearchSourcePackets([packet()], { ...test.access, budget: { remaining: 0 } }, next)).rejects.toThrow('normalized response changed');
    expect(test.generate).toHaveBeenCalledTimes(2);
  });
});
