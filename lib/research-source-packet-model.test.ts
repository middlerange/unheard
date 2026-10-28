import { describe, expect, it } from 'vitest';
import { researchEvidenceSchema, researchHash } from './research-model';
import { researchSourceReviewPassages } from './research-source-review-model';
import {
  RESEARCH_SOURCE_PACKET_VERSION, RESEARCH_SOURCE_PACKET_INSTRUCTIONS,
  researchSourcePacketMetadata, researchSourcePacketSchema, normalizeResearchSourcePacket,
  RESEARCH_SOURCE_PACKET_V2_VERSION, RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS,
  researchSourcePacketMetadataV2, researchSourcePacketSchemaV2, normalizeResearchSourcePacketV2,
  type ResearchSourcePacket,
} from './research-source-packet-model';

const profiles = ['personal', 'company'];
const connectorText = 'The publisher documents one connector for account review and approved changes. It reads current operating state and sends the create_draft request described in the creation reference. A user must approve writes before anything changes in a live account.';
const creationText = 'The creation reference documents create_draft on that same connector. It creates a draft from supplied brand material, which the reviewer checks before publishing. This reference describes a capability and supplies no customer deployment results.';
function packet(): ResearchSourcePacket {
  return { id: 'configured-packet', primarySourceId: 'actual-connector-document', relationship: {
    type: 'same_publisher', reason: 'Both original pages are the publisher’s documentation for the same connector.', sourceIds: ['actual-connector-document', 'actual-creation-document'],
  }, sources: [
    { id: 'actual-connector-document', url: 'https://publisher.example/connector', publishedAt: 1_000, firstSeen: 5_000, content: connectorText },
    { id: 'actual-creation-document', url: 'https://publisher.example/creation', publishedAt: null, firstSeen: 6_000, content: creationText },
  ] };
}
function frame(familyKey = 'review-then-create') {
  return { primarySourceId: 'actual-connector-document', evidenceCitations: [
    { sourceId: 'actual-connector-document', passageIds: [0] }, { sourceId: 'actual-creation-document', passageIds: [0] },
  ], relationshipSupport: 'documented_relationship', relationshipExplanation: 'Both references explicitly name the same connector and create_draft operation.',
  claimBasis: 'described_method', familyKey,
  profileChecks: [
    { profileId: 'personal', fits: true, relevance: 22, reason: 'A concrete approval and draft-creation workflow for practitioners.' },
    { profileId: 'company', fits: false, relevance: 0, reason: 'Outside this company publishing profile’s configured remit.' },
  ], qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' },
  claim: { summary: 'The publisher’s connector joins review of operating state with an approved draft-creation operation documented in its creation reference.',
    contentAngle: 'Check which review and creation actions share a connector before trying to automate a handoff.',
    whyItMatters: 'The documentation identifies a concrete handoff and its approval boundary.',
    limitations: 'Two publisher references describe capability and approval behavior; they do not establish a successful customer deployment or improved results.' },
  };
}
const response = (primary: unknown = frame(), additionalIdeas: unknown[] = []) => ({ findings: {
  'configured-packet': { ...(primary as object), additionalIdeas },
} });

describe('explicit original-document research packets', () => {
  it('preserves the original v1 source-binding and normalized-result bytes', async () => {
    const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const metadata = await researchSourcePacketMetadata(packet());
    const result = await normalizeResearchSourcePacket(response(), [packet()], profiles);
    expect(metadata.packetHash).toBe('3b11ad3ea804caa5cdf52d8a6bc769a7d524af616635407b09a925e780670967');
    expect(await researchHash(stable(result))).toBe('f30df75ec46e065361c051b985c88b611034a8d582761f805bb7dcc34afc4dd6');
    expect(metadata).not.toHaveProperty('qualificationPolicyVersion'); expect(result).not.toHaveProperty('qualificationPolicyVersion');
    expect(result.packetProofs[0]).not.toHaveProperty('qualificationPolicyVersion');
  });
  it('emits each original literal catalog once and binds body, URL, date and relationship metadata', async () => {
    const input = packet(), before = JSON.stringify(input), metadata = await researchSourcePacketMetadata(input);
    expect(JSON.stringify(input)).toBe(before); expect(metadata).not.toHaveProperty('content');
    expect(metadata).toMatchObject({ version: RESEARCH_SOURCE_PACKET_VERSION, id: input.id, primarySourceId: input.primarySourceId, relationship: input.relationship });
    expect(metadata.sources).toHaveLength(2);
    for (const [index, source] of metadata.sources.entries()) {
      expect(source).not.toHaveProperty('content'); expect(source).not.toHaveProperty('excerpt');
      expect(source.passages).toEqual(researchSourceReviewPassages(input.sources[index].content));
      expect(source.bodyHash).toBe(await researchHash(input.sources[index].content));
      expect(source.catalogHash).toBe(await researchHash(JSON.stringify(source.passages)));
      expect(source).toMatchObject({ id: input.sources[index].id, url: input.sources[index].url, publishedAt: input.sources[index].publishedAt, firstSeen: input.sources[index].firstSeen });
    }
    expect(await researchSourcePacketMetadata(input)).toEqual(metadata);
    expect(RESEARCH_SOURCE_PACKET_INSTRUCTIONS).toContain('exactly once through submit_research');
    expect(RESEARCH_SOURCE_PACKET_INSTRUCTIONS).toContain('not proof that two capabilities work together');
  });

  it('requires the packet ID, actual primary source and structured original citations without an idea quota', () => {
    const schema = researchSourcePacketSchema(packet(), profiles);
    expect(schema.properties.findings.required).toEqual(['configured-packet']);
    expect(schema.$defs.idea.properties.primarySourceId.enum).toEqual(['actual-connector-document']);
    expect(schema.$defs.idea.properties.evidenceCitations.items.properties.sourceId.enum).toEqual(['actual-connector-document', 'actual-creation-document']);
    expect(schema.$defs.idea.required).toEqual(expect.arrayContaining(['primarySourceId', 'evidenceCitations', 'relationshipSupport', 'relationshipExplanation']));
    expect(schema.$defs.claim.properties).not.toHaveProperty('evidence');
    expect(schema.$defs.sourceAssessment.properties.additionalIdeas).not.toHaveProperty('maxItems');
    expect(schema.$defs.qualityComponents.properties.sourceSupport.type).toBe('string');
  });

  it('normalizes a true coherent synthesis with unchanged categorical score and separately attributed proofs', async () => {
    const input = packet(), result = await normalizeResearchSourcePacket(response(), [input], profiles), actual = result.findings[0];
    const { primarySourceId: _primary, evidenceCitations: _citations, relationshipSupport: _support, relationshipExplanation: _relationship, ...wire } = frame();
    const baseline = researchEvidenceSchema.parse({ findings: [{ itemId: input.primarySourceId, ...wire, claim: { ...wire.claim, evidence: connectorText } }] }).findings[0];
    expect(result.diagnostics).toEqual([]); expect(actual).toMatchObject(baseline); expect(actual.score).toBe(92);
    expect(actual.itemId).toBe(input.primarySourceId); expect(actual.supportingEvidence).toEqual([connectorText, creationText]);
    expect(actual.evidenceCitations).toEqual(frame().evidenceCitations);
    const proof = result.packetProofs[0], metadata = await researchSourcePacketMetadata(input);
    expect(proof.packetHash).toBe(metadata.packetHash); expect(proof.primarySourceId).toBe(input.primarySourceId);
    expect(proof.sources.map(source => source.sourceId)).toEqual(input.sources.map(source => source.id));
    expect(proof.sources[0]).toMatchObject({ url: input.sources[0].url, publishedAt: 1_000, firstSeen: 5_000 });
    expect(proof.sources[1]).toMatchObject({ url: input.sources[1].url, publishedAt: null, firstSeen: 6_000 });
    for (const source of proof.sources) {
      const original = input.sources.find(document => document.id === source.sourceId)!;
      for (const quote of source.passages) expect(original.content.slice(quote.start, quote.end)).toBe(quote.text);
    }
    expect(result.bindings[0].packetHash).toBe(proof.packetHash);
  });

  it('does not turn a same-publisher relationship or two literal quotes into support for a missing bridge', async () => {
    const unsupported = frame(); unsupported.relationshipSupport = 'unsupported_bridge';
    unsupported.relationshipExplanation = 'The documents do not establish that the new operation is available through the named connector.';
    const result = await normalizeResearchSourcePacket(response(unsupported), [packet()], profiles);
    expect(result.findings).toEqual([]); expect(result.packetProofs).toEqual([]);
    expect(result.diagnostics[0].reason).toContain('unsupported necessary relationship bridge');
  });

  it('retains the existing incomplete-support gate without upgrading a well-cited but incomplete synthesis', async () => {
    const incomplete = frame(); incomplete.qualityComponents.sourceSupport = 'incomplete_support';
    incomplete.claim.limitations = 'The necessary link to a production deployment is missing from both otherwise related references.';
    const result = await normalizeResearchSourcePacket(response(incomplete), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings[0].score).toBe(69);
    expect(result.findings[0].qualityComponents?.sourceSupport).toBe(12);
    expect(result.packetProofs[0].sources).toHaveLength(2);
  });

  it('keeps a bounded connector-capability inference only when the selected limitations explicitly retain its boundary', async () => {
    const inference = frame(); inference.relationshipSupport = 'bounded_inference';
    inference.relationshipExplanation = 'Inference: the shared connector may expose the creation operation; this does not establish an actual end-to-end deployment.';
    inference.claim.limitations = inference.relationshipExplanation;
    const result = await normalizeResearchSourcePacket(response(inference), [packet()], profiles);
    expect(result.findings).toHaveLength(1); expect(result.findings[0].score).toBe(92);
    expect(result.findings[0].limitations).toBe(inference.relationshipExplanation);
    expect(result.packetProofs[0].relationshipSupport).toBe('bounded_inference');
    const missing = structuredClone(inference); missing.claim.limitations = 'The documented operations work together in production.';
    expect((await normalizeResearchSourcePacket(response(missing), [packet()], profiles)).diagnostics[0].reason).toContain('explicit in selected limitations');
  });

  it('requires two cited original documents and a primary-document first anchor', async () => {
    const one = frame('one-source'); one.evidenceCitations = [one.evidenceCitations[0]];
    const borrowed = frame('borrowed-anchor'); borrowed.evidenceCitations.reverse();
    const another = frame('changed-primary'); another.primarySourceId = 'actual-creation-document';
    const result = await normalizeResearchSourcePacket(response(one, [borrowed, another, frame('valid-sibling')]), [packet()], profiles);
    expect(result.findings.map(finding => finding.familyKey)).toEqual(['valid-sibling']);
    expect(result.diagnostics.map(diagnostic => diagnostic.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining('at least two distinct'), expect.stringContaining('first citation'), expect.stringContaining('configured real primary'),
    ]));
  });

  it('rejects unknown/unlinked IDs, duplicate citations, context-only spans and invented quotation fields while preserving valid siblings', async () => {
    const input = packet(); input.sources[1].content = '# Note\n\n' + creationText;
    const valid = frame('valid'); valid.evidenceCitations[1].passageIds = [1];
    const unknown = structuredClone(valid); unknown.familyKey = 'foreign-source'; unknown.evidenceCitations[1].sourceId = 'unlinked-document';
    const duplicate = structuredClone(valid); duplicate.familyKey = 'duplicate-source'; duplicate.evidenceCitations[1].sourceId = duplicate.evidenceCitations[0].sourceId;
    const context = structuredClone(valid); context.familyKey = 'context-only'; context.evidenceCitations[1].passageIds = [0];
    const invented = { ...valid, familyKey: 'invented-quote', evidence: 'An invented quotation absent from all sources.' };
    const result = await normalizeResearchSourcePacket(response(unknown, [duplicate, context, invented, valid]), [input], profiles);
    expect(result.findings.map(finding => finding.familyKey)).toEqual(['valid']); expect(result.diagnostics).toHaveLength(4);
    expect(result.findings[0].supportingEvidence).toEqual([connectorText, creationText]);
  });

  it('does not accept missing profiles, numeric score overrides or a tampered literal catalog', async () => {
    const absent = frame('missing-profile'); absent.profileChecks = absent.profileChecks.slice(0, 1);
    const override = { ...frame('score-override'), score: 100 };
    const result = await normalizeResearchSourcePacket(response(absent, [override, frame('valid')]), [packet()], profiles);
    expect(result.findings.map(finding => finding.familyKey)).toEqual(['valid']); expect(result.diagnostics).toHaveLength(2);
    const input = packet(); input.sources[1].passages = researchSourceReviewPassages(input.sources[1].content);
    input.sources[1].passages[0].text = connectorText;
    await expect(normalizeResearchSourcePacket(response(), [input], profiles)).rejects.toThrow('catalog changed');
  });

  it('binds exact unknown dates, first observation, original URLs, bodies and relationship rather than fabricating a composite publication', async () => {
    const original = packet(), first = await researchSourcePacketMetadata(original);
    for (const field of ['publishedAt', 'firstSeen', 'url', 'content'] as const) {
      const changed = structuredClone(original);
      if (field === 'publishedAt' || field === 'firstSeen') changed.sources[1][field] = 9_000;
      else if (field === 'url') changed.sources[1].url = 'https://publisher.example/revised';
      else changed.sources[1].content += ' This sentence is a later documented limitation.';
      expect((await researchSourcePacketMetadata(changed)).packetHash).not.toBe(first.packetHash);
    }
    const changed = structuredClone(original); changed.relationship.reason += ' This is a revised explicit relationship scope.';
    expect((await researchSourcePacketMetadata(changed)).packetHash).not.toBe(first.packetHash);
    expect(first).not.toHaveProperty('publishedAt'); expect(first.sources[1].publishedAt).toBeNull();
  });

  it('retains JavaScript UTF16 offsets for non-ASCII source text', async () => {
    const input = packet(); input.sources[0].content = '🧭 Workflow\n\n' + connectorText;
    const wire = frame(); wire.evidenceCitations[0].passageIds = [1];
    const result = await normalizeResearchSourcePacket(response(wire), [input], profiles);
    expect(result.findings).toHaveLength(1);
    const quote = result.packetProofs[0].sources[0].passages[0];
    expect(input.sources[0].content.slice(quote.start, quote.end)).toBe(connectorText);
    expect(quote.start).toBe('🧭 Workflow\n\n'.length);
  });

  it('permits every packet to reject without an acceptance quota', async () => {
    const rejected = frame(); rejected.claimBasis = 'no_useful_core'; rejected.evidenceCitations = [];
    rejected.relationshipSupport = 'unsupported_bridge'; rejected.claim.limitations = 'The sources omit the necessary bridge and do not support a coherent useful workflow.';
    rejected.profileChecks = rejected.profileChecks.map(profile => ({ ...profile, fits: false, relevance: 0 }));
    rejected.qualityComponents = { sourceSupport: 'unsupported', usefulDecision: 'none', scopeHonesty: 'accurately_bounded' };
    const result = await normalizeResearchSourcePacket(response(rejected), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings[0].score).toBe(0); expect(result.packetProofs[0].sources).toEqual([]);
  });

  it('retains all useful additional frames while de-duplicating families by first actual claim', async () => {
    const higherDuplicate = frame('review-then-create'); higherDuplicate.profileChecks[0].relevance = 30;
    higherDuplicate.claim.summary = 'A later higher-scoring paraphrase must not replace the original accepted family.';
    const result = await normalizeResearchSourcePacket(response(frame(), [higherDuplicate, ...Array.from({ length: 25 }, (_, index) => frame('distinct-' + index))]), [packet()], profiles);
    expect(result.findings).toHaveLength(26); expect(result.findings[0].score).toBe(92); expect(result.findings[0].summary).toBe(frame().claim.summary);
    expect(result.packetProofs).toHaveLength(26); expect(result.diagnostics[0].reason).toContain('Duplicate packet idea family');
  });

  it('rejects malformed source relationships instead of accepting arbitrary documents as a trusted packet', async () => {
    const missing = packet(); missing.relationship.sourceIds.pop();
    await expect(researchSourcePacketMetadata(missing)).rejects.toThrow('bind every original');
    const publisher = packet(); publisher.sources[1].url = 'https://unrelated.example/creation';
    await expect(researchSourcePacketMetadata(publisher)).rejects.toThrow('source hosts');
    const repo = packet(); repo.relationship.type = 'same_repository'; repo.sources[0].url = 'https://github.com/owner/one'; repo.sources[1].url = 'https://github.com/owner/two/blob/main/SKILL.md';
    await expect(researchSourcePacketMetadata(repo)).rejects.toThrow('source repositories');
    const configured = packet(); configured.relationship.type = 'configured_reference'; configured.sources[1].url = 'https://other-documentation.example/creation';
    expect((await researchSourcePacketMetadata(configured)).relationship.type).toBe('configured_reference');
    const invalidDate = packet(); invalidDate.sources[1].publishedAt = Number.NaN;
    await expect(researchSourcePacketMetadata(invalidDate)).rejects.toThrow('timestamps or null');
  });
});

describe('opt-in structured packet qualification v2', () => {
  function inference() {
    const idea = frame(); idea.relationshipSupport = 'bounded_inference';
    idea.relationshipExplanation = 'The same-product documents describe complementary operations; their use in one workflow is an editorial connection rather than observed deployment.';
    idea.claim.contentAngle = 'Our proposed comparison: evaluate the permission boundary before attempting this workflow.';
    idea.claim.limitations = 'The connection is a bounded inference from separate documented capabilities, not proof of a shared implementation or a successful deployment.';
    return idea;
  }

  it('keeps v1 source/catalog hashes while separately versioning the opt-in qualifier', async () => {
    const input = packet(), first = await researchSourcePacketMetadata(input), next = await researchSourcePacketMetadataV2(input);
    const { qualificationPolicyVersion, ...sourceBinding } = next;
    expect(qualificationPolicyVersion).toBe(RESEARCH_SOURCE_PACKET_V2_VERSION); expect(sourceBinding).toEqual(first);
    expect(next.version).toBe(RESEARCH_SOURCE_PACKET_VERSION); expect(next.packetHash).toBe(first.packetHash);
    expect(researchSourcePacketSchemaV2(input, profiles)).toEqual(researchSourcePacketSchema(input, profiles));
    expect(RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS).not.toContain('Return the primary core plus every other independently useful core');
    expect(RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS).toContain('Do not enumerate single-document components');
    expect(RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS).toContain('Editorial synthesis is allowed');
    expect(RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS).toContain('it need not repeat relationshipExplanation verbatim');
  });

  it('recovers only the disclosure-format failure without changing actual model claims, categories, profiles, quotes or limitations', async () => {
    const idea = inference(), raw = response(idea), before = JSON.stringify(raw), input = packet();
    const first = await normalizeResearchSourcePacket(raw, [input], profiles), next = await normalizeResearchSourcePacketV2(raw, [input], profiles);
    expect(first.findings).toEqual([]); expect(first.diagnostics[0].reason).toContain('explicit in selected limitations');
    expect(next.diagnostics).toEqual([]); expect(next.findings).toHaveLength(1); expect(JSON.stringify(raw)).toBe(before);
    const finding = next.findings[0];
    for (const key of ['summary', 'contentAngle', 'whyItMatters', 'limitations'] as const) expect(finding[key]).toBe(idea.claim[key]);
    expect(finding.score).toBe(92); expect(finding.profileChecks?.personal.relevance).toBe(22);
    expect(finding.supportingEvidence).toEqual([connectorText, creationText]); expect(finding.evidenceCitations).toEqual(idea.evidenceCitations);
    expect(next.packetProofs[0]).toMatchObject({ version: RESEARCH_SOURCE_PACKET_VERSION, qualificationPolicyVersion: RESEARCH_SOURCE_PACKET_V2_VERSION,
      relationshipSupport: idea.relationshipSupport, relationshipExplanation: idea.relationshipExplanation });
    const strict = frame(); strict.relationshipSupport = idea.relationshipSupport; strict.relationshipExplanation = idea.relationshipExplanation;
    strict.claim = { ...idea.claim, limitations: idea.relationshipExplanation + ' This is a bounded inference.' };
    const baseline = await normalizeResearchSourcePacket(response(strict), [input], profiles);
    expect(finding.qualityComponents).toEqual(baseline.findings[0].qualityComponents);
    expect(next.packetProofs[0].sources).toEqual(baseline.packetProofs[0].sources);
    expect(next.bindings).toEqual(baseline.bindings);
  });

  it('still rejects unmarked inference, unsupported bridges, one-document frames and borrowed primary anchors', async () => {
    const unmarked = inference(); unmarked.claim.limitations = 'These documents describe capabilities and do not establish an observed deployment.';
    const unsupported = inference(); unsupported.relationshipSupport = 'unsupported_bridge';
    const one = inference(); one.evidenceCitations.pop();
    const borrowed = inference(); borrowed.evidenceCitations.reverse();
    const result = await normalizeResearchSourcePacketV2(response(unmarked, [unsupported, one, borrowed]), [packet()], profiles);
    expect(result.findings).toEqual([]); expect(result.diagnostics).toHaveLength(4);
    expect(result.diagnostics.map(item => item.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining('explicit in selected limitations'), expect.stringContaining('unsupported necessary relationship'),
      expect.stringContaining('at least two distinct'), expect.stringContaining('first citation'),
    ]));
  });

  it('does not upgrade incomplete support or relevance through the new disclosure policy', async () => {
    const incomplete = inference(); incomplete.qualityComponents.sourceSupport = 'incomplete_support';
    const weak = inference(); weak.familyKey = 'weak-profile'; weak.profileChecks[0].relevance = 10;
    const result = await normalizeResearchSourcePacketV2(response(incomplete, [weak]), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings.map(idea => idea.score)).toEqual([69, 69]);
    expect(result.findings[0].qualityComponents?.sourceSupport).toBe(12); expect(result.findings[1].profileChecks?.personal.relevance).toBe(10);
    expect(result.findings.every(idea => idea.score < 70)).toBe(true);
  });

  it('strips only an empty structural additionalIdeas field on children and preserves raw data', async () => {
    const child = { ...frame('second-coherent-synthesis'), additionalIdeas: [] }, raw = response(frame(), [child]), before = JSON.stringify(raw);
    expect((await normalizeResearchSourcePacket(raw, [packet()], profiles)).findings).toHaveLength(1);
    const next = await normalizeResearchSourcePacketV2(raw, [packet()], profiles);
    expect(next.findings).toHaveLength(2); expect(next.diagnostics).toEqual([]); expect(JSON.stringify(raw)).toBe(before);
    const nested = { ...child, additionalIdeas: [frame('hidden-third')] };
    const unknown = { ...child, score: 100 };
    const malformed = { ...child, additionalIdeas: 'not-an-array' };
    const rejected = await normalizeResearchSourcePacketV2(response(frame(), [nested, unknown, malformed]), [packet()], profiles);
    expect(rejected.findings).toHaveLength(1); expect(rejected.diagnostics).toHaveLength(3);
  });
});
