import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { researchEvidenceSchema, researchHash } from './research-model';
import { researchSourceReviewPassages } from './research-source-review-model';
import {
  RESEARCH_SOURCE_PACKET_VERSION, RESEARCH_SOURCE_PACKET_INSTRUCTIONS,
  researchSourcePacketMetadata, researchSourcePacketSchema, normalizeResearchSourcePacket,
  RESEARCH_SOURCE_PACKET_V2_VERSION, RESEARCH_SOURCE_PACKET_V2_INSTRUCTIONS, RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS, RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS,
  researchSourcePacketMetadataV2, researchSourcePacketSchemaV2, normalizeResearchSourcePacketV2, normalizeResearchSourcePacketV4, normalizeResearchSourcePacketV5, normalizeResearchSourcePacketV9, researchSourcePacketSchemaV9, canonicalizeResearchSourcePacketV5,
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
  it('keeps reader-decision coverage separate from unchanged relationship and outcome standards',()=>{
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('After finding one useful frame, continue inspecting');
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('what can be done, how a described method works');
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('An inspectable sequence can support a bounded method brief without proof that a customer deployed it');
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('at least two distinct configured documents');
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('An unsupported bridge cannot qualify');
    expect(RESEARCH_SOURCE_PACKET_V3_INSTRUCTIONS).toContain('There is no acceptance quota');
  });
  it('asks for a complete primary reader story without changing evidence or relationship standards', () => {
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('Start the primary frame with the complete coherent main reader story');
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('actions, artifacts and handoffs');
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('without implying that separate resources automatically chain together');
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('claim has EXACTLY these four keys');
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('An unsupported bridge cannot qualify');
    expect(RESEARCH_SOURCE_PACKET_V4_INSTRUCTIONS).toContain('There is no acceptance quota');
  });
  it('removes only exact empty claim contentAngleNote in v4, without mutating raw frames or any grade', async () => {
    const primary = frame(), child = frame('another-method');
    const raw = response({ ...primary, claim: { ...primary.claim, contentAngleNote: '' } },
      [{ ...child, claim: { ...child.claim, contentAngleNote: '' } }]);
    const original = JSON.stringify(raw);
    const old = await normalizeResearchSourcePacketV2(raw, [packet()], profiles);
    expect(old.findings).toEqual([]); expect(old.diagnostics).toHaveLength(2);
    const next = await normalizeResearchSourcePacketV4(raw, [packet()], profiles);
    const expected = await normalizeResearchSourcePacketV2(response(primary, [child]), [packet()], profiles);
    expect(next).toEqual(expected); expect(next.findings).toHaveLength(2);
    expect(next.findings.every(idea => idea.score === 92)).toBe(true);
    expect(JSON.stringify(raw)).toBe(original);
    for (const fields of [{ contentAngleNote: 'nonempty' }, { contentAngleNote: ' ' }, { contentAngleNote: null },
      { contentAngleNote: 0 }, { claim_note: '' }, { contentAngleNote: '', other: '' }]) {
      const invalid = response({ ...primary, claim: { ...primary.claim, ...fields } }, [child]);
      const result = await normalizeResearchSourcePacketV4(invalid, [packet()], profiles);
      expect(result.findings).toHaveLength(1); expect(result.findings[0].familyKey).toBe(child.familyKey);
      expect(result.diagnostics[0].reason).toContain('unknown fields');
    }
  });
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
  it('v5 removes only unknown empty frame/claim placeholders without mutating raw claims or grades', async () => {
    const raw = response({ ...frame(), claim_note: null, extra: [], claim: { ...frame().claim, summary_note: '', metadata_note: {} } },
      [{ ...frame('child'), note: {}, claim: { ...frame().claim, limitations_note_placeholder: null } }]);
    const before = JSON.stringify(raw), canonical = canonicalizeResearchSourcePacketV5(raw);
    expect(canonical.removedPaths).toEqual(['/findings/configured-packet/claim_note', '/findings/configured-packet/extra',
      '/findings/configured-packet/claim/summary_note', '/findings/configured-packet/claim/metadata_note',
      '/findings/configured-packet/additionalIdeas/0/note', '/findings/configured-packet/additionalIdeas/0/claim/limitations_note_placeholder']);
    expect((await normalizeResearchSourcePacketV4(raw, [packet()], profiles)).findings).toHaveLength(0);
    const next = await normalizeResearchSourcePacketV5(raw, [packet()], profiles);
    expect(next).toEqual(await normalizeResearchSourcePacketV2(response(frame(), [frame('child')]), [packet()], profiles));
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('v5 preserves complete long primary and additional claims with the same score and literal proofs', async () => {
    const baseline = await normalizeResearchSourcePacketV4(response(frame(), [frame('child')]), [packet()], profiles);
    const primary = frame(), child = frame('child');
    for (const claim of [primary.claim, child.claim]) for (const field of ['summary', 'contentAngle', 'whyItMatters', 'limitations'] as const)
      claim[field] = claim[field].repeat(100);
    const raw = response(primary, [child]), before = JSON.stringify(raw);
    expect((await normalizeResearchSourcePacketV4(raw, [packet()], profiles)).findings).toEqual([]);
    const result = await normalizeResearchSourcePacketV5(raw, [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings).toHaveLength(2);
    for (const [index, candidate] of [primary, child].entries()) {
      for (const field of ['summary', 'contentAngle', 'whyItMatters', 'limitations'] as const) expect(result.findings[index][field]).toBe(candidate.claim[field]);
      expect(result.findings[index].score).toBe(baseline.findings[index].score);
      expect(result.findings[index].qualityComponents).toEqual(baseline.findings[index].qualityComponents);
    }
    expect(result.packetProofs).toEqual(baseline.packetProofs);
    expect(JSON.stringify(raw)).toBe(before);
    const unsupported = response({ ...primary, qualityComponents: { ...primary.qualityComponents, sourceSupport: 'unsupported' } });
    expect((await normalizeResearchSourcePacketV5(unsupported, [packet()], profiles)).findings[0].score).toBeLessThan(70);
    const unknown = response({ ...primary, claim: { ...primary.claim, note: 'meaningful unknown text' } });
    expect((await normalizeResearchSourcePacketV5(unknown, [packet()], profiles)).diagnostics[0].reason).toContain('unknown fields');
  });
  it.each([0, false, ' ', 'nonempty', [null], { note: null }])('v5 retains unknown nonempty or meaningful value %j for strict rejection', async value => {
    for (const raw of [response({ ...frame(), unknown: value }), response({ ...frame(), claim: { ...frame().claim, unknown: value } })]) {
      expect(canonicalizeResearchSourcePacketV5(raw).removedPaths).toEqual([]);
      const result = await normalizeResearchSourcePacketV5(raw, [packet()], profiles);
      expect(result.findings).toEqual([]); expect(result.diagnostics[0].reason).toContain('unknown fields');
    }
  });
  it('v5 never drops known empty claim/frame fields or changes nested evidence and categories', async () => {
    const raw = response({ ...frame(), primarySourceId: '', claim: { ...frame().claim, summary: null },
      qualityComponents: { ...frame().qualityComponents, extra: null } });
    expect(canonicalizeResearchSourcePacketV5(raw)).toEqual({ value: raw, removedPaths: [] });
    expect((await normalizeResearchSourcePacketV5(raw, [packet()], profiles)).findings).toEqual([]);
  });

});

describe('structured reader decision packet contract', () => {
  function structuredFrame(familyKey = 'inspect-draft') {
    return { ...frame(familyKey), relationshipSupport: 'bounded_inference',
      relationshipExplanation: 'The documented draft and approval steps support our proposed inspection, not an observed outcome.',
      claim: { readerDecision: { mode: 'proposed_evaluation', question: 'Can this draft support an approved handoff?',
        answer: 'Inspect the generated draft before deciding whether to approve it.',
        inspection: { output: 'The generated draft.', action: 'Compare its contents with the supplied material.',
          decisionCriterion: 'Whether the draft preserves the material needed for this handoff.', basis: 'analyst_proposed' } },
        factualCore: { kind: 'mechanism', input: 'Supplied brand material.', action: 'Create a draft for human review.',
          output: 'A draft to inspect before publishing.', conditions: 'User approval is required for live changes.' },
        whyItMatters: 'The reader can inspect the handoff without assuming it worked.',
        limitations: 'The proposed inspection is our inference, not a publisher-endorsed protocol or an observed outcome.' } };
  }
  it('uses a strict question-first claim schema without duplicate legacy prose fields', () => {
    const schema = researchSourcePacketSchemaV9(packet(), profiles), claim = schema.$defs.claim;
    expect(Object.keys(claim.properties!)).toEqual(['readerDecision', 'factualCore', 'whyItMatters', 'limitations']);
    expect(claim.required).toEqual(['readerDecision', 'factualCore', 'whyItMatters', 'limitations']);
    expect(claim.additionalProperties).toBe(false);
    expect(claim.properties).not.toHaveProperty('summary'); expect(claim.properties).not.toHaveProperty('contentAngle');
    const old = researchSourcePacketSchemaV2(packet(), profiles);
    expect({ ...schema.$defs, claim: old.$defs.claim }).toEqual(old.$defs);
    expect(schema.properties).toEqual(old.properties);
  });
  it('renders every evaluation and mechanism component verbatim in the same selected frame', async () => {
    const primary = structuredFrame(), child = structuredFrame('second-question');
    child.claim.readerDecision.question = '  A separate question?\n'; child.claim.factualCore.conditions = '  A separate condition. ';
    child.claim.readerDecision.inspection.basis = 'documented';
    const raw = response(primary, [child]), before = JSON.stringify(raw);
    expect(z.fromJSONSchema(JSON.parse(JSON.stringify(researchSourcePacketSchemaV9(packet(), profiles)))).safeParse(raw).success).toBe(true);
    const result = await normalizeResearchSourcePacketV9(raw, [packet()], profiles);
    expect(JSON.stringify(raw)).toBe(before); expect(result.diagnostics).toEqual([]); expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({ score: 92,
      summary: 'Input: Supplied brand material.\nAction: Create a draft for human review.\nOutput: A draft to inspect before publishing.\nConditions: User approval is required for live changes.',
      contentAngle: 'Reader question: Can this draft support an approved handoff?\nAnswer (proposed_evaluation): Inspect the generated draft before deciding whether to approve it.\nInspect output: The generated draft.\nInspection action: Compare its contents with the supplied material.\nDecision criterion: Whether the draft preserves the material needed for this handoff.\nCriterion basis: analyst_proposed',
      whyItMatters: primary.claim.whyItMatters, limitations: primary.claim.limitations });
    expect(result.findings[1].contentAngle).toContain('Reader question:   A separate question?\n\nAnswer');
    expect(result.findings[1].contentAngle).toContain('Criterion basis: documented');
    expect(result.findings[1].summary).toContain('Conditions:   A separate condition. ');
    expect(result.findings[0].contentAngle).not.toContain('A separate question');
    expect(result.packetProofs.map(proof => proof.ideaIndex)).toEqual([0, 1]);
  });
  it.each(['informative', 'application'])('renders %s decisions without requiring a test and omits null conditions', async mode => {
    const primary: any = structuredFrame();
    primary.claim.readerDecision = { mode, question: 'What does the publisher describe?', answer: 'A draft-creation capability with approval.' };
    primary.claim.factualCore.conditions = null;
    const result = await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings[0].contentAngle).toBe(`Reader question: What does the publisher describe?\nAnswer (${mode}): A draft-creation capability with approval.`);
    expect(result.findings[0].summary).not.toContain('Conditions:'); expect(result.findings[0].contentAngle).not.toContain('Inspection');
  });
  it.each(['measured_observation', 'reasoned_position'])('preserves %s signals with an observation and no invented method or experiment', async claimBasis => {
    const primary: any = structuredFrame(); primary.claimBasis = claimBasis;
    primary.claim.readerDecision = { mode: 'informative', question: 'What is the attributed finding?', answer: 'The publisher describes an approval boundary.' };
    primary.claim.factualCore = { kind: 'observation', observation: '  The publisher describes an approval boundary.\n' };
    primary.qualityComponents.usefulDecision = 'useful_distinction_or_signal';
    const result = await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings[0]).toMatchObject({ claimBasis, score: 86, summary: 'Observation:   The publisher describes an approval boundary.\n' });
    expect(result.findings[0].contentAngle).not.toMatch(/Inspect output|Decision criterion/);
  });
  it('preserves complete long structured strings without truncation', async () => {
    const primary = structuredFrame(), long = 'A documented component remains intact. '.repeat(100);
    primary.claim.factualCore.input = long; primary.claim.readerDecision.inspection.decisionCriterion = long;
    const result = await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings[0].summary).toContain(`Input: ${long}\nAction:`);
    expect(result.findings[0].contentAngle).toContain(`Decision criterion: ${long}\nCriterion basis:`);
  });
  it('rejects missing evaluation parts, wrong branches/types and unknown fields without coercion', async () => {
    const wire = z.fromJSONSchema(JSON.parse(JSON.stringify(researchSourcePacketSchemaV9(packet(), profiles))));
    expect(wire.safeParse(response(structuredFrame(), [structuredFrame('valid-child')])).success).toBe(true);
    const changes: Array<(value: any) => void> = [
      ...['output', 'action', 'decisionCriterion', 'basis'].map(key => (value: any) => { delete value.claim.readerDecision.inspection[key]; }),
      value => { delete value.claim.readerDecision.inspection; }, value => { delete value.claim.factualCore.conditions; },
      value => { value.claim.readerDecision.inspection.basis = 'our_guess'; }, value => { value.claim.readerDecision.inspection.action = '   '; },
      value => { value.claim.limitations = ['No coercion']; }, value => { value.claim.whyItMatters = []; },
      value => { value.claim.factualCore.output = 42; }, value => { value.claim.factualCore.conditions = ''; },
      value => { value.claim.readerDecision.question = ''; }, value => { value.claim.note = ''; },
      value => { value.claim.summary = 'Duplicate prose'; }, value => { value.claim.contentAngle = 'Duplicate prose'; },
      value => { value.claim.readerDecision.note = null; }, value => { value.claim.readerDecision.inspection.extra = ''; },
      value => { value.claim.factualCore.extra = []; }, value => { value.note = ''; },
      value => { value.claim.readerDecision.mode = 'informative'; },
      value => { value.claim.factualCore.kind = 'observation'; },
      value => { value.claim = frame().claim; },
    ];
    for (const change of changes) {
      const primary: any = structuredFrame(); change(primary);
      const result = await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles);
      expect(wire.safeParse(response(primary)).success).toBe(false);
      expect(wire.safeParse(response(structuredFrame(), [primary])).success).toBe(false);
      expect(result.findings).toEqual([]); expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].rawIdea).toEqual(primary);
    }
  });
  it('fails malformed assessment containers closed without accepting an otherwise valid primary', async () => {
    const wire = z.fromJSONSchema(JSON.parse(JSON.stringify(researchSourcePacketSchemaV9(packet(), profiles))));
    for (const additionalIdeas of [undefined, null, {}, '']) {
      const raw: any = response(structuredFrame()); raw.findings['configured-packet'].additionalIdeas = additionalIdeas;
      expect(wire.safeParse(raw).success).toBe(false);
      const result = await normalizeResearchSourcePacketV9(raw, [packet()], profiles);
      expect(result.findings).toEqual([]); expect(result.diagnostics[0].rawIdea).toEqual(raw.findings['configured-packet']);
    }
    const unknown: any = response(structuredFrame()); unknown.findings.unconfigured = structuredFrame();
    expect(wire.safeParse(unknown).success).toBe(false);
    expect((await normalizeResearchSourcePacketV9(unknown, [packet()], profiles)).findings).toEqual([]);
  });
  it('cannot fill an incomplete child from its parent or accept nested child frames', async () => {
    const child: any = structuredFrame('incomplete'); delete child.claim.readerDecision.inspection.decisionCriterion;
    let result = await normalizeResearchSourcePacketV9(response(structuredFrame(), [child]), [packet()], profiles);
    expect(result.findings).toHaveLength(1); expect(result.diagnostics[0]).toMatchObject({ ideaIndex: 1, rawIdea: child });
    child.claim.readerDecision.inspection.decisionCriterion = 'A criterion.'; child.additionalIdeas = [];
    result = await normalizeResearchSourcePacketV9(response(structuredFrame(), [child]), [packet()], profiles);
    expect(result.findings).toHaveLength(1); expect(result.diagnostics[0].reason).toContain('Packet idea');
  });
  it('retains literal quotation, relationship, full profile and categorical qualification checks', async () => {
    const changes: Array<(value: any) => void> = [value => { value.relationshipSupport = 'unsupported_bridge'; },
      value => { value.evidenceCitations[1].passageIds = [999]; }, value => { value.profileChecks.pop(); },
      value => { value.claim.limitations = 'No disclosure of the proposed connection.'; }];
    for (const change of changes) {
      const primary = structuredFrame(); change(primary);
      expect((await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles)).findings).toEqual([]);
    }
    for (const changed of [{ sourceSupport: 'unsupported' }, { usefulDecision: 'generic' }, { scopeHonesty: 'material_gap' }]) {
      const primary = structuredFrame(); Object.assign(primary.qualityComponents, changed);
      expect((await normalizeResearchSourcePacketV9(response(primary), [packet()], profiles)).findings[0].score).toBeLessThan(70);
    }
  });
});
