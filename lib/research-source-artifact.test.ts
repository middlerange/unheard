import { describe, expect, it } from 'vitest';
import { researchSourceArtifactPolicy, researchSourceArtifactContract, RESEARCH_SOURCE_ARTIFACT_VERSION, RESEARCH_SOURCE_ARTIFACT_FORMAT } from './research-source-artifact';
import { normalizeResearchSourceDepth, researchSourceDepthRequestMetadata, researchSourceDepthSchema } from './research-source-depth-model';
import { researchSourceReviewPassages } from './research-source-review-model';

const content = 'The public card lists three exports per week and two tracked projects in the entry tier. Its next tier lists twenty exports per week and ten tracked projects. The page provides no readable price and does not say that the free-start button grants an ongoing free plan.';
const source = { id: 'public-usage-card', url: 'https://publisher.example/plans', publishedAt: null, discoveredAt: 1000,
  content, passages: researchSourceReviewPassages(content) };
function assessment(support: 'supported_bounded_claim' | 'incomplete_support' = 'supported_bounded_claim') {
  return { claimBasis: 'reported_capability', familyKey: 'published-usage-boundary',
    profileChecks: [{ profileId: 'personal', fits: true, relevance: 22, reason: 'Inspectable access and usage boundaries support a bounded monetization comparison.' }],
    claim: { summary: 'The publisher’s entry and next tiers differ in weekly exports and tracked projects.', evidencePassageIds: [0],
      contentAngle: 'Proposed inspection: check which useful task fits inside each published allowance.', whyItMatters: 'An explicit usage boundary can inform a product team’s pricing inspection.',
      limitations: 'Publisher-listed allowances; unreadable pricing, ongoing free access and conversion effects remain unknown.' },
    qualityComponents: { sourceSupport: support, usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' }, additionalIdeas: [],
  };
}
const raw = (support?: 'supported_bounded_claim' | 'incomplete_support') => ({ findings: { [source.id]: { wholeSource: assessment(support), groups: {} } } });
describe('opt-in public artifact review', () => {
  it('uses the existing categorical schema, score and literal source normalizer unchanged', async () => {
    const policy = researchSourceArtifactPolicy(), metadata = await researchSourceDepthRequestMetadata(source);
    expect(policy.sourceSchema!(source, ['personal'])).toEqual(researchSourceDepthSchema(source, ['personal']));
    const normalized = await policy.normalize!(raw(), [source], ['personal']);
    expect(normalized).toEqual(await normalizeResearchSourceDepth(raw(), [source], ['personal']));
    expect(normalized.findings[0].score).toBe(92);expect(normalized.findings[0].evidence).toBe(source.content);
    expect(normalized.proofs[0]).toMatchObject({ bodyHash: metadata.depth.bodyHash, catalogHash: metadata.depth.catalogHash, depthVersion: 'research-source-depth-v1' });
  });
  it('does not upgrade incomplete support because the source is an artifact', async () => {
    const normalized = await researchSourceArtifactPolicy().normalize!(raw('incomplete_support'), [source], ['personal']);
    expect(normalized.findings[0].score).toBe(69);expect(normalized.findings[0].limitations).toContain('remain unknown');
  });
  it('binds format and output budget while emitting only range metadata beside the existing single catalog', async () => {
    const policy = researchSourceArtifactPolicy(16384), metadata = await policy.requestMetadata!(source);
    expect(metadata).toEqual({ groups: {}, depth: (await researchSourceDepthRequestMetadata(source)).depth,
      artifact: { version: RESEARCH_SOURCE_ARTIFACT_VERSION, format: RESEARCH_SOURCE_ARTIFACT_FORMAT }, reviewTransport: 'anthropic-tool-v1', reviewOutputTokens: 16384 });
    expect(metadata).not.toHaveProperty('content');expect(metadata).not.toHaveProperty('passages');
    expect(researchSourceArtifactContract().schema).toEqual(researchSourceDepthSchema({ id: 'item', content: '' }, ['profile']));
    expect(() => researchSourceArtifactPolicy(128001)).toThrow('output budget');
  });
  it('keeps the own-source anchor and rejects a borrowed or nonexistent passage', async () => {
    const invalid = raw(); invalid.findings[source.id].wholeSource.claim.evidencePassageIds = [99];
    const normalized = await researchSourceArtifactPolicy().normalize!(invalid, [source], ['personal']);
    expect(normalized.findings).toEqual([]);expect(normalized.diagnostics[0].reason).toContain('literal selectable passages');
  });
});
