import { describe, expect, it } from 'vitest';
import { researchHash, validateResearchEvidence } from './research-model';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import {
  researchSourceFormContract, researchSourceFormPolicy, RESEARCH_SOURCE_FORM_FORMAT,
  RESEARCH_SOURCE_FORM_INSTRUCTIONS, RESEARCH_SOURCE_FORM_MODEL, RESEARCH_SOURCE_FORM_VERSION,
} from './research-source-form';
import {
  normalizeResearchSourceReview, RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS,
  researchSourceReviewPassages, researchSourceReviewSchemaForItems, type ResearchSourceReviewSource,
} from './research-source-review-model';

const profileIds = ['company', 'personal'];
function source(id: string, content: string): ResearchSourceReviewSource {
  return { id, content, passages: researchSourceReviewPassages(content), publishedAt: null };
}
const form = source('workflow-study', [
  'Contributors should describe a product-research workflow before and after introducing an assistant, including what changed.',
  'Attach a screenshot or a short demonstration of the workflow. A partial demonstration is sufficient; omit confidential material.',
  'A researcher reviews submissions and may arrange a follow-up interview. Contributors review their account before publication.',
].join('\n\n'));
const agenda = source('community-evening', 'Join our community evening for a stretching class, dinner and informal conversation. Register to receive the venue address.');
const welcome = source('series-welcome', 'Welcome to our product research interview series. Meet the hosts and subscribe for future conversations about product work.');
function idea(input = form) {
  return { claimBasis: 'described_method', familyKey: 'evidence-submission-handoff',
    profileChecks: [
      { profileId: 'company', fits: false, relevance: 0, reason: 'No direct user adoption or customer communication lesson.' },
      { profileId: 'personal', fits: true, relevance: 22, reason: 'A bounded product-research contribution and evidence-intake decision.' },
    ],
    claim: { summary: 'The study requests a before/after workflow account and a partial demonstration, followed by researcher review and possible interview, with contributor review before publication.',
      evidencePassageIds: input.passages.filter(passage => passage.selectable).map(passage => passage.passageId),
      contentAngle: 'Inspect the contribution requirements and review handoffs before submitting an existing workflow.',
      whyItMatters: 'A product practitioner can assess the evidence and follow-up requested of a contributor.',
      limitations: 'An announced study intake, not completed findings; impact, selection criteria and current availability are unknown.' },
    qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' },
    additionalIdeas: [],
  };
}
function rejection(input: ResearchSourceReviewSource) {
  return { ...idea(input), claimBasis: 'no_useful_core', familyKey: 'invitation-without-method',
    profileChecks: profileIds.map(profileId => ({ profileId, fits: false, relevance: 0, reason: 'No substantive reader-job finding or method in the captured invitation.' })),
    claim: { summary: 'The source invites readers to a community activity or introductory series.', evidencePassageIds: [],
      contentAngle: 'No supported method teardown.', whyItMatters: 'The audience label does not supply a reader decision.',
      limitations: 'Only the invitation is captured; no unseen session or episode content is inferred.' },
    qualityComponents: { sourceSupport: 'unsupported', usefulDecision: 'none', scopeHonesty: 'accurately_bounded' },
  };
}
const raw = (input: ResearchSourceReviewSource, assessment: unknown = idea(input)) => ({ findings: { [input.id]: assessment } });

// These supplied assessments exercise validator contracts, not model judgment or actual source outcomes.
describe('isolated research intake form policy', () => {
  it('extends the unchanged instructions and binds the standard schema, model, format and output budget', async () => {
    const policy = researchSourceFormPolicy(16384), contract = researchSourceFormContract(16384);
    expect(RESEARCH_SOURCE_FORM_INSTRUCTIONS.startsWith(RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS)).toBe(true);
    expect(policy.normalize).toBe(normalizeResearchSourceReview);
    expect(policy.sourceSchema!(form, profileIds)).toEqual(researchSourceReviewSchemaForItems([form.id], profileIds));
    expect(contract).toEqual({ version: RESEARCH_SOURCE_FORM_VERSION, format: RESEARCH_SOURCE_FORM_FORMAT,
      instructions: RESEARCH_SOURCE_FORM_INSTRUCTIONS, model: RESEARCH_SOURCE_FORM_MODEL,
      schema: researchSourceReviewSchemaForItems(['item'], ['profile']), outputTokens: 16384 });
    expect(RESEARCH_SOURCE_FORM_MODEL).toBe('claude-sonnet-5-5');
    expect(RESEARCH_SOURCE_FORM_FORMAT).toBe('research_intake_form');
    expect(await policy.requestMetadata!(form)).toEqual({ artifact: { version: RESEARCH_SOURCE_FORM_VERSION, format: RESEARCH_SOURCE_FORM_FORMAT },
      reviewTransport: 'anthropic-tool-v1', reviewOutputTokens: 16384 });
    expect(JSON.stringify(contract.schema)).not.toContain('wholeSource');
    expect(JSON.stringify(contract.schema)).not.toContain('score');
    expect(RESEARCH_POST_MIN_SCORE).toBe(70);
  });

  it.each([0, -1, 1.5, NaN, 128001])('rejects invalid output budget %s in both factories', outputTokens => {
    expect(() => researchSourceFormPolicy(outputTokens)).toThrow('output budget');
    expect(() => researchSourceFormContract(outputTokens)).toThrow('output budget');
  });

  it('preserves data, score, frozen profile checks and literal proof using the existing normalizer', async () => {
    const response = raw(form), before = JSON.stringify({ form, response });
    const result = await researchSourceFormPolicy().normalize!(response, [form], profileIds);
    expect(result).toEqual(await normalizeResearchSourceReview(response, [form], profileIds));
    expect(result.diagnostics).toEqual([]);
    expect(result.findings[0].score).toBe(92);
    expect(result.findings[0].chosenProfileId).toBe('personal');
    expect(result.proofs[0]).toMatchObject({ bodyHash: await researchHash(form.content), catalogHash: await researchHash(JSON.stringify(form.passages)) });
    expect(result.findings[0].supportingEvidence).toEqual(form.passages.map(passage => passage.text));
    for (const passage of result.proofs[0].passages) expect(passage.text).toBe(form.content.slice(passage.start, passage.end));
    expect(JSON.stringify({ form, response })).toBe(before);
  });

  it.each([agenda, welcome])('does not let a research form label upgrade the supplied rejected $id core', async input => {
    const response = raw(input, rejection(input)), labeled = { ...input, artifact: { version: RESEARCH_SOURCE_FORM_VERSION, format: RESEARCH_SOURCE_FORM_FORMAT } };
    const result = await researchSourceFormPolicy().normalize!(response, [labeled], profileIds);
    expect(result).toEqual(await normalizeResearchSourceReview(response, [input], profileIds));
    expect(result.findings[0].score).toBe(0);
    expect(validateResearchEvidence(result.findings, [input])).toEqual([]);
  });

  it.each(['unsupported', 'incomplete_support'])('keeps an ungrounded effectiveness claim with %s below the existing threshold', async support => {
    const assessment = idea();
    assessment.claim.summary = 'The intake procedure improves product-research accuracy and reduces operating costs.';
    assessment.claim.limitations = 'No measured accuracy or cost result is captured.';
    assessment.qualityComponents.sourceSupport = support;
    const response = raw(form, assessment), policy = researchSourceFormPolicy();
    const result = await policy.normalize!(response, [form], profileIds);
    expect(result).toEqual(await normalizeResearchSourceReview(response, [form], profileIds));
    expect(result.findings[0].score).toBeLessThan(RESEARCH_POST_MIN_SCORE);
    expect(validateResearchEvidence(result.findings, [form])).toEqual([]);
  });

  it('requires a supported useful decision, honest scope and at least adjacent profile fit', async () => {
    const variants = [
      { ...idea(), qualityComponents: { ...idea().qualityComponents, usefulDecision: 'generic' } },
      { ...idea(), qualityComponents: { ...idea().qualityComponents, scopeHonesty: 'misleading' } },
      { ...idea(), profileChecks: idea().profileChecks.map(check => ({ ...check, fits: false })) },
      { ...idea(), profileChecks: idea().profileChecks.map(check => ({ ...check, relevance: check.fits ? 15 : 0 })) },
    ];
    for (const assessment of variants) {
      const result = await researchSourceFormPolicy().normalize!(raw(form, assessment), [form], profileIds);
      expect(result.findings[0].score).toBeLessThan(RESEARCH_POST_MIN_SCORE);
      expect(validateResearchEvidence(result.findings, [form])).toEqual([]);
    }
  });

  it('requires own-source literal passages and the exact enabled profile roster', async () => {
    const missingQuote = idea(); missingQuote.claim.evidencePassageIds = [];
    const missingProfile = idea(); missingProfile.profileChecks = missingProfile.profileChecks.slice(1);
    const unknownProfile = idea(); unknownProfile.profileChecks[0].profileId = 'unconfigured';
    const nonexistentQuote = idea(); nonexistentQuote.claim.evidencePassageIds = [99];
    for (const assessment of [missingQuote, missingProfile, unknownProfile, nonexistentQuote]) {
      const result = await researchSourceFormPolicy().normalize!(raw(form, assessment), [form], profileIds);
      expect(result.findings).toEqual([]); expect(result.diagnostics).toHaveLength(1);
    }
    for (const changed of [{ ...form, passages: agenda.passages }, { ...form, content: form.content.replace('researcher', 'operator') }]) {
      const result = await researchSourceFormPolicy().normalize!(raw(form), [changed], profileIds);
      expect(result.findings).toEqual([]); expect(result.diagnostics[0].reason).toContain('catalog does not match');
    }
  });

  it('rejects a model-supplied score override instead of treating the format as acceptance', async () => {
    const response = raw(form, { ...idea(), score: 100 });
    const result = await researchSourceFormPolicy().normalize!(response, [form], profileIds);
    expect(result.findings).toEqual([]); expect(result.diagnostics[0].reason).toContain('unknown fields');
  });
});
