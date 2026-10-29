import { describe, expect, it } from 'vitest';
import { researchHash } from './research-model';
import { normalizeResearchSourceReview } from './research-source-review-model';
import { normalizeResearchSourceDepth, researchSourceDepthRequestMetadata, researchSourceDepthSchema } from './research-source-depth-model';
import { researchSourceQuoteDepthRequestMetadata, RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION } from './research-source-depth-quotes';
import {
  researchQuestionRanges, researchSourceDepthGroupingRoute, researchSourceQuestionDepthRequestMetadata,
  researchSourceQuestionDepthSchema, normalizeResearchSourceQuestionDepth, researchSourceDepthQuestionPolicy, RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT, RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION,
  RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION,
} from './research-source-depth-questions';

const profiles = ['personal'];
const content = '😀 The publisher describes a configurable workflow and its prerequisites. '.repeat(240)
  + '\n\nFrequently asked questions\n\nWhat does the optional routing mode do?\n\n'
  + 'The optional routing mode compares incoming requests with the documented rules before sending them to a named owner. '.repeat(5)
  + '\n\nHow can a team inspect the routing decision?\n\n'
  + 'An operator can inspect the recorded rule and destination in the decision log; this requires enabling the log before the request arrives. '.repeat(5)
  + '\n\nCan every account enable the decision log?\n\n'
  + 'The log is available only for managed accounts with the documented permission. Other accounts must request access.\n\nFurther information\n\nThe public documentation keeps its separate prerequisites.';
const source = (text = content) => ({ id: 'public-document', url: 'https://publisher.example/reference', content: text, publishedAt: null, discoveredAt: 1234 });
function frame(ids: number[], familyKey: string, rejected = false) {
  return { claimBasis: rejected ? 'no_useful_core' : 'described_method', familyKey,
    profileChecks: [{ profileId: 'personal', fits: !rejected, relevance: rejected ? 0 : 22, reason: rejected ? 'No independent supported core.' : 'A concrete operational product decision.' }],
    qualityComponents: { sourceSupport: rejected ? 'unsupported' : 'supported_bounded_claim', usefulDecision: rejected ? 'none' : 'concrete_decision', scopeHonesty: 'accurately_bounded' },
    claim: { summary: rejected ? 'No useful independent core.' : 'The publisher describes inspecting a recorded routing rule, with logging enabled before the request.',
      evidencePassageIds: ids, contentAngle: rejected ? '' : 'Enable the decision log before investigating a routing choice.',
      whyItMatters: rejected ? '' : 'The prior configuration determines whether the choice is inspectable.',
      limitations: rejected ? 'No additional supported decision in this group.' : 'A documented capability and prerequisite, not measured improvement.' }, additionalIdeas: [],
  };
}
async function fixture() {
  const input = source(), metadata = await researchSourceQuestionDepthRequestMetadata(input), groups = Object.values(metadata.groups);
  const questions = groups.filter(group => group.kind === 'question_section');
  const raw = { findings: { [input.id]: { wholeSource: frame([], '', true), groups: Object.fromEntries(groups.map(group => [group.id, frame([], '', true)])) } } };
  return { input, metadata, groups, questions, raw };
}

describe('opt-in standalone question depth groups', () => {
  it('preserves the pinned pre-FAQ default metadata, schema and normalized result hash', async () => {
    const input = { id: 'fixed-public-doc', url: 'https://publisher.example/reference', publishedAt: null,
      content: 'The public reference describes a bounded product workflow and its explicit operating prerequisite. '.repeat(80) };
    const metadata = await researchSourceDepthRequestMetadata(input);
    const rejected = { claimBasis: 'no_useful_core', familyKey: '', profileChecks: [{ profileId: 'personal', fits: false, relevance: 0, reason: 'No supported independent core.' }],
      qualityComponents: { sourceSupport: 'unsupported', usefulDecision: 'none', scopeHonesty: 'accurately_bounded' },
      claim: { summary: 'No independent useful core.', evidencePassageIds: [], contentAngle: '', whyItMatters: '', limitations: 'No independent supported decision in this group.' }, additionalIdeas: [] };
    const raw = { findings: { [input.id]: { wholeSource: rejected, groups: Object.fromEntries(Object.keys(metadata.groups).map(id => [id, rejected])) } } };
    const snapshot = { metadata, schema: researchSourceDepthSchema(input, profiles), result: await normalizeResearchSourceDepth(raw, [{ ...input, ...metadata }], profiles) };
    expect(await researchHash(JSON.stringify(snapshot))).toBe('fbc1955f355507e147477948c498f010262f5981cba9aea70d8b12573d81371f');
  });
  it('requires every literal late answer, preserves UTF16 ranges and the final captured tail, without repeating the catalog', async () => {
    const { input, metadata, questions, groups } = await fixture();
    expect(questions).toHaveLength(3); expect(questions[0].start).toBeGreaterThan(14000);
    for (const [index, group] of questions.entries()) {
      expect(input.content.slice(group.start, group.bodyStart).trim()).toBe(group.title);
      expect(group.end).toBe(questions[index + 1]?.start ?? input.content.length);
      expect(group.selectablePassageIds.length).toBeGreaterThan(0);
    }
    expect(input.content.slice(questions.at(-1)!.bodyStart, questions.at(-1)!.end)).toContain('separate prerequisites.');
    expect(metadata.passages.map(p => p.text).join('').replace(/\s/g, '')).toBe(input.content.replace(/\s/g, ''));
    expect(metadata).not.toHaveProperty('content'); expect(groups.every(group => !Object.hasOwn(group, 'passages'))).toBe(true);
    expect(metadata.depth).toEqual({ version: RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION, groupingVersion: RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION,
      bodyHash: await researchHash(input.content), catalogHash: await researchHash(JSON.stringify(metadata.passages)), groupsHash: await researchHash(JSON.stringify(metadata.groups)) });
    const schema = researchSourceQuestionDepthSchema(input, profiles);
    expect(schema.properties.findings.properties[input.id].properties.groups.required).toEqual(groups.map(group => group.id));
    expect(schema.properties.findings.properties[input.id].properties.groups.additionalProperties).toBe(false);
    expect(schema.$defs).toEqual(researchSourceDepthSchema(input, profiles).$defs);
    expect(await researchSourceDepthQuestionPolicy.requestMetadata!({ ...input, passages: metadata.passages })).toEqual({ groups: metadata.groups, depth: metadata.depth, ...RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT });
    expect(RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT).toEqual({ reviewTimeoutMs: 240000, reviewClaimLeaseMs: 270000 });
  });

  it('requires a standalone paragraph question, excludes quoted prose and does not invent a missing answer', () => {
    const invalid = ['Why?', 'A prose paragraph asks what should happen? More prose follows.', '“Which workflow should the team use?”', '"Which workflow should the team use?"',
      'A line with context\nWhat should the team choose?', 'What happens without an answer?'].join('\n\n');
    const emptyAnswer = researchQuestionRanges('FAQ\n\n' + invalid);
    expect(emptyAnswer).toHaveLength(1); expect(emptyAnswer[0].title).toBe('What happens without an answer?'); expect(emptyAnswer[0].bodyStart).toBe(emptyAnswer[0].end);
    expect(researchQuestionRanges('What should the team choose?\n\nAn answer without a publisher FAQ heading remains ordinary source context.')).toEqual([]);
    const unicode = '😀 Context.\r\n\r\nQ&A\r\n\r\nWhich option fits this constraint?\r\n\r\nThe documented answer preserves the actual constraint.';
    const [question] = researchQuestionRanges(unicode);
    expect(question.start).toBe(unicode.indexOf('Which')); expect(unicode.slice(question.bodyStart)).toBe('The documented answer preserves the actual constraint.');
    expect(researchQuestionRanges('FAQ\n\nCan a U.S. account use “routing only” mode?\n\nThe public answer documents the account permission.')).toHaveLength(1);
  });

  it('keeps quote-first routing and every existing default/quote serialized binding unchanged', async () => {
    const { input } = await fixture(), quoteInput = source('“A reviewer records the actual unresolved assumption before handing a choice to implementation.” — Alex Rivera\n\n' + input.content);
    const before = JSON.stringify(await researchSourceQuoteDepthRequestMetadata(quoteInput));
    expect(researchSourceDepthGroupingRoute(quoteInput.content, RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION)).toBe('quotes');
    expect(researchSourceDepthGroupingRoute(quoteInput.content, RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION)).toBe('quotes');
    expect(researchSourceDepthGroupingRoute(input.content, RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION)).toBeNull();
    expect(researchSourceDepthGroupingRoute(input.content, RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION)).toBe('questions');
    expect(researchSourceDepthGroupingRoute('A normal public paragraph without a question.', RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION)).toBeNull();
    const baseline = await researchSourceDepthRequestMetadata(input), frozen = JSON.stringify(baseline);
    await researchSourceQuestionDepthRequestMetadata(input);
    expect(JSON.stringify(await researchSourceDepthRequestMetadata(input))).toBe(frozen);
    expect(JSON.stringify(await researchSourceQuoteDepthRequestMetadata(quoteInput))).toBe(before);
    expect(() => researchSourceDepthGroupingRoute(input.content, 'unknown')).toThrow('Unknown');
  });

  it('uses unchanged categorical scores and own-answer anchors, allows contextual quotes and retains missing-group diagnostics', async () => {
    const { input, metadata, questions, raw } = await fixture();
    const focal = questions[1].selectablePassageIds[0], context = questions[0].selectablePassageIds[0];
    raw.findings[input.id].groups[questions[1].id] = frame([focal, context], 'inspect-recorded-routing');
    delete raw.findings[input.id].groups[questions[2].id];
    const expected = await normalizeResearchSourceReview({ findings: { [input.id]: frame([focal, context], 'inspect-recorded-routing') } }, [{ ...input, passages: metadata.passages }], profiles);
    const result = await normalizeResearchSourceQuestionDepth(raw, [{ ...input, ...metadata }], profiles);
    const finding = result.findings.find(row => row.familyKey === 'inspect-recorded-routing');
    expect(finding).toEqual(expected.findings[0]); expect(finding!.score).toBe(92);
    const proof = result.proofs.find(row => row.familyKey === finding!.familyKey)!;
    expect(proof).toMatchObject({ depthVersion: RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION, groupId: questions[1].id, focalPassageIds: [focal], bodyHash: metadata.depth.bodyHash });
    for (const passage of proof.passages) expect(input.content.slice(passage.start, passage.end)).toBe(passage.text);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ groupId: questions[2].id, reason: expect.stringContaining('Missing or malformed required') }));
    raw.findings[input.id].groups[questions[1].id] = frame([context, focal], 'borrowed-answer-anchor');
    const borrowed = await normalizeResearchSourceQuestionDepth(raw, [input], profiles);
    expect(borrowed.findings.some(row => row.familyKey === 'borrowed-answer-anchor')).toBe(false);
    expect(borrowed.diagnostics.some(row => row.reason.includes('first literal citation anchor'))).toBe(true);
  });

  it('permits all groups to reject and fails closed for stale body, catalog or question ranges', async () => {
    const { input, metadata, groups, raw } = await fixture();
    const result = await normalizeResearchSourceQuestionDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings).toHaveLength(groups.length + 1); expect(result.findings.every(row => row.score < 70)).toBe(true);
    for (const change of ['body', 'catalog', 'range'] as const) {
      const changed = { ...input, ...structuredClone(metadata) };
      if (change === 'body') changed.content += ' Changed captured text.';
      if (change === 'catalog') changed.passages[0].text += ' invented';
      if (change === 'range') changed.groups[groups.at(-1)!.id].end--;
      const rejected = await normalizeResearchSourceQuestionDepth(raw, [changed], profiles);
      expect(rejected.findings).toEqual([]); expect(rejected.diagnostics[0].reason).toContain('binding changed');
    }
    const oldMetadata = await researchSourceDepthRequestMetadata(input);
    expect((await normalizeResearchSourceQuestionDepth(raw, [{ ...input, ...oldMetadata }], profiles)).findings).toEqual([]);
    expect((await normalizeResearchSourceDepth(raw, [{ ...input, ...metadata }], profiles)).findings).toEqual([]);
  });

  it('requires an explicit rejection for a captured final question with no answer', async () => {
    const input = source('An earlier source paragraph provides factual context for the documented workflow.\n\nFAQ\n\nHow does the missing answer describe the workflow?');
    const metadata = await researchSourceQuestionDepthRequestMetadata(input), group = Object.values(metadata.groups)[0];
    expect(group.bodyStart).toBe(group.end); expect(group.selectablePassageIds).toEqual([]);
    const raw = { findings: { [input.id]: { wholeSource: frame([], '', true), groups: { [group.id]: frame([0], 'borrowed-context') } } } };
    const result = await normalizeResearchSourceQuestionDepth(raw, [input], profiles);
    expect(result.findings.every(row => row.score < 70)).toBe(true);
    expect(result.diagnostics.some(row => row.reason.includes('first literal citation anchor'))).toBe(true);
    raw.findings[input.id].groups[group.id] = frame([], '', true);
    expect((await normalizeResearchSourceQuestionDepth(raw, [input], profiles)).diagnostics).toEqual([]);
  });
});
