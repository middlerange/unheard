import { describe, expect, it } from 'vitest';
import type { ResearchAudience } from './research-audience';
import { evidenceJsonSchemaForItems, researchEvidenceSchema, researchHash } from './research-model';
import { researchSelectionAudience } from './research-selection-audience';
import {
  normalizeResearchSourceReview, RESEARCH_SOURCE_REVIEW_INSTRUCTIONS, RESEARCH_SOURCE_REVIEW_VERSION,
  researchSourceReviewAudience, researchSourceReviewPassages, researchSourceReviewSchemaForItems,
  type ResearchSourceReviewSource,
} from './research-source-review-model';

const writing = 'Writing and evidence: Develop one original insight. Open with a specific observation or defensible tension, explain the mechanism with a concrete example, and end with a useful implication or action. Use plain English, calm curiosity, varied sentence lengths, and paragraphs of 1-3 sentences. Avoid theatrical one-line formatting, corporate filler, hype, copied expressions, canned contrast formulas, hashtags, emojis, engagement bait, and routine sales pitches.';
const evidence = 'Attribute reported claims and retain sample limitations.';
function audience(): ResearchAudience {
  return { generalAudience: 'Product and growth research.', publishingProfiles: [{
    id: 'personal', name: 'Practitioner', platform: 'linkedin', groupName: 'personal', enabled: true, kind: 'publishing_profile',
    systemPrompt: [
      'Identity and purpose: A warm voice and a short post. Keep writing compact.',
      'Audience and selection: Product, growth and founder decisions; exclude unsupported hype.',
      `${writing} ${evidence} These are drafts for review; publishing requires explicit approval of the latest version in Slack.`,
      'Discovery breadth: Include concrete distribution and team operating choices.',
      'Product-team decisions: Preserve geography, population and uncertainty.',
      'Distribution identity: This profile belongs to the personal account identity. Each story must choose exactly one configured account identity and provide versions for all of its enabled, supported publishing channels. A single draft or approval must never mix company and personal identities or other account groups. Choose the identity whose purpose best fits the source, then adapt its one post for the platforms in that group.',
    ].join('\n\n'),
  }] };
}
function source(id = 'source-a', content = '## Intake\n\nA coordinator records the request and its unresolved assumptions.\n\n## Review\n\nA reviewer checks those assumptions, then passes a decision record to the implementer.'): ResearchSourceReviewSource {
  return { id, content, passages: researchSourceReviewPassages(content), publishedAt: null, contentProvenance: 'article' };
}
function idea(evidencePassageIds: number[], familyKey = 'intake-review-handoff') {
  return {
    claimBasis: 'described_method', familyKey,
    profileChecks: [{ profileId: 'personal', fits: true, relevance: 22, reason: 'A concrete practitioner workflow decision.' }],
    qualityComponents: { sourceSupport: 'supported_bounded_claim', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' },
    claim: { summary: 'The coordinator records assumptions; a reviewer checks them before a decision record reaches the implementer.',
      evidencePassageIds, contentAngle: 'Compare explicit review and handoff to an informal request queue.',
      whyItMatters: 'It identifies who checks the assumptions and what carries forward.', limitations: 'A described method, not evidence of faster delivery.' },
  };
}
const response = (primary: unknown, additionalIdeas: unknown = []) => ({ findings: { 'source-a': { ...(primary as object), additionalIdeas } } });

describe('source review research audience', () => {
  it.each(['\n\n', '\\n\\n'])('removes only the recognized identity paragraph while retaining every research remit (%s)', separator => {
    const captured = audience();
    captured.publishingProfiles[0].systemPrompt = captured.publishingProfiles[0].systemPrompt.replaceAll('\n\n', separator);
    const before = JSON.stringify(captured), base = researchSelectionAudience(captured), result = researchSourceReviewAudience(captured);
    expect(result.sourceReviewVersion).toBe(RESEARCH_SOURCE_REVIEW_VERSION);
    expect(result.publishingProfiles[0].selectionInstructions).toBe(base.publishingProfiles[0].selectionInstructions.split('\n\n').slice(1).join('\n\n'));
    expect(result.publishingProfiles[0].selectionInstructions).toContain(evidence);
    for (const marker of ['Audience and selection:', 'Discovery breadth:', 'Product-team decisions:'])
      expect(result.publishingProfiles[0].selectionInstructions).toContain(marker);
    expect(result.publishingProfiles[0].selectionInstructions).not.toContain('Identity and purpose:');
    expect(result.publishingProfiles[0].id).toBe('personal');
    expect(base.publishingProfiles[0].selectionInstructions).toContain('Identity and purpose:');
    expect(JSON.stringify(captured)).toBe(before);
  });

  it('preserves unfamiliar freeform prompts exactly, including identity-like custom constraints', () => {
    const captured = audience();
    const custom = '  Identity and purpose: Only cover public transit.\n\nDo not remove this custom scope.  ';
    captured.publishingProfiles[0].systemPrompt = custom;
    const result = researchSourceReviewAudience(captured).publishingProfiles[0];
    expect(result.selectionProjection).toBe('full_prompt');
    expect(result.selectionInstructions).toBe(custom);
  });
});

describe('literal full-source passage catalog', () => {
  it('covers every non-whitespace character once with exact offsets and visible short headings', () => {
    const long = `${'A bounded sentence explains the next review handoff. '.repeat(31)}${'x'.repeat(1300)} tail`;
    const content = `  # Intro\n\n${long}\n\n## End\n\nThis final paragraph must remain visible after every earlier paragraph.\n`;
    const passages = researchSourceReviewPassages(content);
    expect(passages).toEqual(researchSourceReviewPassages(content));
    let end = 0;
    for (const [id, passage] of passages.entries()) {
      expect(content.slice(end, passage.start).trim()).toBe('');
      expect(passage.text).toBe(content.slice(passage.start, passage.end));
      expect(passage.text.length).toBeLessThanOrEqual(600);
      expect(passage.selectable).toBe(passage.text.length >= 20);
      expect(passage.passageId).toBe(id);
      end = passage.end;
    }
    expect(content.slice(end).trim()).toBe('');
    expect(passages.at(-1)?.text).toContain('final paragraph');
    const endHeading = passages.find(passage => passage.text === '## End')!;
    expect(endHeading.selectable).toBe(false);
    expect(passages.at(-1)?.headingContext).toEqual([endHeading.passageId]);
  });

  it('splits long paragraphs at natural boundaries before resorting to literal token cuts', () => {
    const sentence = 'A complete sentence keeps its rationale and its concrete example together.';
    const passages = researchSourceReviewPassages(Array(24).fill(sentence).join(' '));
    expect(passages.length).toBeGreaterThan(2);
    expect(passages.every(passage => passage.text.endsWith('.'))).toBe(true);
    const unicode = researchSourceReviewPassages(`🧭 ${'z'.repeat(597)}🧭${'y'.repeat(90)}`);
    expect(unicode.map(passage => passage.text).join('')).toBe(`🧭 ${'z'.repeat(597)}🧭${'y'.repeat(90)}`);
    expect(unicode.every(passage => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(passage.text))).toBe(true);
  });
});

describe('source review schema and calibration', () => {
  it('retains existing categorical/profile contracts and replaces only the citation representation', () => {
    const baseline = evidenceJsonSchemaForItems(['source-a'], ['personal']);
    const schema = researchSourceReviewSchemaForItems(['source-a'], ['personal']);
    expect(schema.$defs.qualityComponents).toEqual(baseline.$defs.qualityComponents);
    expect(schema.$defs.profileCheck).toEqual(baseline.$defs.profileCheck);
    expect(schema.$defs.sourceAssessment).toEqual(baseline.$defs.sourceAssessment);
    expect(schema.$defs.claim.properties).not.toHaveProperty('evidence');
    expect(schema.$defs.claim.properties).toHaveProperty('evidencePassageIds');
    expect(schema.$defs.claim.required).toContain('evidencePassageIds');
    expect(JSON.stringify(schema)).not.toContain('sectionChecks');
    expect(RESEARCH_SOURCE_REVIEW_INSTRUCTIONS).toContain('complete workflow');
    expect(RESEARCH_SOURCE_REVIEW_INSTRUCTIONS).toContain('It need not demonstrate causal returns');
    expect(RESEARCH_SOURCE_REVIEW_INSTRUCTIONS).not.toContain('EXACT contiguous 20-600 character quote');
  });
});

describe('independent source review idea normalization', () => {
  it('copies multiple own-source passages separately, preserving the old score and every semantic field', async () => {
    const input = source(), ids = input.passages.filter(passage => passage.selectable).map(passage => passage.passageId), frame = idea(ids);
    const raw = response(frame), before = JSON.stringify(raw), result = await normalizeResearchSourceReview(raw, [input], ['personal']);
    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const expected = researchEvidenceSchema.parse({ findings: [{ itemId: input.id, ...frame,
      claim: { ...Object.fromEntries(Object.entries(frame.claim).filter(([key]) => key !== 'evidencePassageIds')), evidence: input.passages[ids[0]].text } }] }).findings[0];
    const { supportingEvidence, ...normalized } = result.findings[0];
    expect(normalized).toEqual(expected);
    expect(normalized.score).toBe(92);
    expect(normalized.chosenProfileId).toBe('personal');
    expect(normalized.evidence).toBe(input.passages[ids[0]].text);
    expect(supportingEvidence).toEqual(ids.map(id => input.passages[id].text));
    expect(result.proofs[0]).toMatchObject({ itemId: input.id, familyKey: frame.familyKey, evidencePassageIds: ids,
      bodyHash: await researchHash(input.content), catalogHash: await researchHash(JSON.stringify(input.passages)) });
    for (const passage of result.proofs[0].passages) expect(passage.text).toBe(input.content.slice(passage.start, passage.end));
    expect(JSON.stringify(raw)).toBe(before);
  });

  it.each(['score', 'chosenProfileId', 'profileFit', 'qualificationRubric'])('excludes a model-supplied %s override while preserving valid siblings', async key => {
    const input = source(), id = input.passages.find(passage => passage.selectable)!.passageId;
    const invalid = { ...idea([id]), [key]: key === 'score' ? 100 : 'override' }, valid = idea([id], 'valid-sibling');
    const result = await normalizeResearchSourceReview(response(invalid, [valid]), [input], ['personal']);
    expect(result.findings.map(finding => finding.familyKey)).toEqual(['valid-sibling']);
    expect(result.diagnostics[0]).toMatchObject({ itemId: input.id, ideaIndex: 0, rawIdea: invalid });
  });

  it.each([[999], [-1], [1.5], [1, 1], []].map(ids => ({ ids })))('excludes invalid or missing passing passage IDs $ids without synthesizing a rejection', async ({ ids }) => {
    const input = source(), result = await normalizeResearchSourceReview(response(idea(ids)), [input], ['personal']);
    expect(result.findings).toEqual([]);
    expect(result.proofs).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('rejects short context-only citations and catalogs borrowed from a different body', async () => {
    const input = source(), short = input.passages.find(passage => !passage.selectable)!.passageId;
    expect((await normalizeResearchSourceReview(response(idea([short])), [input], ['personal'])).findings).toEqual([]);
    const other = source('other', 'A different source describes an unrelated behavior with no shared handoff.');
    const borrowed = { ...input, passages: other.passages };
    const result = await normalizeResearchSourceReview(response(idea([0])), [borrowed], ['personal']);
    expect(result.findings).toEqual([]);
    expect(result.diagnostics[0].reason).toContain('catalog does not match');
    const changed = { ...input, content: input.content.replace('coordinator', 'operator') };
    expect((await normalizeResearchSourceReview(response(idea([1])), [changed], ['personal'])).findings).toEqual([]);
  });

  it('keeps a valid primary when an additional frame has malformed profile checks or legacy evidence', async () => {
    const input = source(), id = input.passages.find(passage => passage.selectable)!.passageId;
    const wrongProfile = { ...idea([id], 'wrong-profile'), profileChecks: [{ profileId: 'outsider', fits: true, relevance: 30, reason: 'Unknown profile.' }] };
    const legacy = idea([id], 'legacy-citation');
    const malformed = { ...legacy, claim: { ...legacy.claim, evidence: input.passages[id].text } };
    const result = await normalizeResearchSourceReview(response(idea([id]), [wrongProfile, malformed]), [input], ['personal']);
    expect(result.findings).toHaveLength(1);
    expect(result.diagnostics.map(diagnostic => diagnostic.ideaIndex)).toEqual([1, 2]);
  });

  it('preserves valid rejected grades and caps incomplete support using the unchanged categorical rubric', async () => {
    const input = source(), id = input.passages.find(passage => passage.selectable)!.passageId;
    const incomplete = { ...idea([id]), qualityComponents: { sourceSupport: 'incomplete_support', usefulDecision: 'concrete_decision', scopeHonesty: 'accurately_bounded' } };
    const rejected = { ...idea([], 'no-useful-core'), claimBasis: 'no_useful_core',
      profileChecks: [{ profileId: 'personal', fits: false, relevance: 0, reason: 'No supported practitioner decision.' }],
      qualityComponents: { sourceSupport: 'unsupported', usefulDecision: 'none', scopeHonesty: 'accurately_bounded' } };
    const result = await normalizeResearchSourceReview(response(incomplete, [rejected]), [input], ['personal']);
    expect(result.diagnostics).toEqual([]);
    expect(result.findings.map(finding => finding.score)).toEqual([69, 0]);
    expect(result.findings[1].evidence).toBe('');
    expect(result.findings[1].supportingEvidence).toEqual([]);
  });

  it('does not let numeric legacy grades, duplicate profiles or duplicate families bypass validation', async () => {
    const input = source(), id = input.passages.find(passage => passage.selectable)!.passageId, valid = idea([id]);
    const numeric = { ...idea([id], 'legacy-numeric'), qualityComponents: { sourceSupport: 25, usefulDecision: 30, scopeHonesty: 15 } };
    const repeatedProfile = { ...idea([id], 'repeat-profile'), profileChecks: [...valid.profileChecks, ...valid.profileChecks] };
    const result = await normalizeResearchSourceReview(response(valid, [numeric, repeatedProfile, valid]), [input], ['personal']);
    expect(result.findings).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(3);
  });

  it('retains diagnostics for unknown or missing sources without fabricating assessments', async () => {
    const input = source(), result = await normalizeResearchSourceReview({ findings: { unknown: {} } }, [input], ['personal']);
    expect(result.findings).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.reason)).toEqual(['Unknown source ID', 'Missing or malformed source assessment']);
  });
});
