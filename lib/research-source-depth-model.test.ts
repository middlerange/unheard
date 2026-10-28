import { describe, expect, it } from 'vitest';
import { researchHash } from './research-model';
import { researchSectionInventory } from './research-sections';
import { researchEvidenceWindows } from './research-window-focus';
import { normalizeResearchSourceReview, researchSourceReviewSchemaForItems } from './research-source-review-model';
import {
  RESEARCH_SOURCE_DEPTH_VERSION, RESEARCH_SOURCE_DEPTH_INSTRUCTIONS, researchSourceDepthSchema,
  researchSourceDepthRequestMetadata, normalizeResearchSourceDepth, type ResearchSourceDepthSource,
} from './research-source-depth-model';

const profiles = ['personal'];
const content = 'An attributed survey compares five operational choices without claiming causal business improvement.\n\n'
  + Array.from({ length: 5 }, (_, index) => `Insight ${index + 1}: ${index === 4 ? 'Tool selection and operating limits' : 'Channel choice ' + (index + 1)}\n\n`
    + Array.from({ length: 12 }, (_, n) => `Finding ${index + 1}, detail ${n + 1}: the publisher describes checking the buyer context and the operating limit before choosing this workflow. ${index === 4 ? 'Tool Alpha handles intake; Tool Beta handles the checked handoff.' : 'Compare direct acquisition with the documented alternative before changing the channel.'}`).join(' ')).join('\n\n');
const source = (id = 'original-item', text = content): ResearchSourceDepthSource => ({ id, url: 'https://publisher.example/original-study', content: text, publishedAt: null, contentProvenance: 'article' });
function frame(evidencePassageIds: number[], familyKey: string, rejected = false) {
  return { claimBasis: rejected ? 'no_useful_core' : 'described_method', familyKey,
    profileChecks: [{ profileId: 'personal', fits: !rejected, relevance: rejected ? 0 : 22, reason: rejected ? 'No supported reader decision in this passage.' : 'A concrete product and growth workflow.' }],
    qualityComponents: { sourceSupport: rejected ? 'unsupported' : 'supported_bounded_claim', usefulDecision: rejected ? 'none' : 'concrete_decision', scopeHonesty: 'accurately_bounded' },
    claim: { summary: rejected ? 'No supported independent core.' : 'The publisher describes a bounded workflow choice and its operating limits.',
      evidencePassageIds, contentAngle: rejected ? '' : 'Compare the documented choice before changing this workflow.',
      whyItMatters: rejected ? '' : 'The alternative and the limit affect which workflow fits.',
      limitations: rejected ? 'This group provides no additional supported practitioner decision.' : 'Attributed described method, not measured effectiveness.' },
  };
}
const assessment = (idea: ReturnType<typeof frame>, additionalIdeas: ReturnType<typeof frame>[] = []) => ({ ...idea, additionalIdeas });
async function fixture(input = source()) {
  const metadata = await researchSourceDepthRequestMetadata(input), groups = Object.values(metadata.groups);
  const raw = { findings: { [input.id]: { wholeSource: assessment(frame([], '', true)),
    groups: Object.fromEntries(groups.map((group, index) => [group.id, assessment(frame([group.selectablePassageIds[0]], 'group-core-' + index))])) } } };
  return { input, metadata, groups, raw };
}

describe('one-call whole-source and mandatory depth-group contract', () => {
  it('requires every actual numbered group, including the late fifth section, with no acceptance or additional-idea quota', async () => {
    const { input, metadata, groups } = await fixture(), schema = researchSourceDepthSchema(input, profiles);
    const itemSchema = schema.properties.findings.properties[input.id], baseline = researchSourceReviewSchemaForItems([input.id], profiles);
    expect(groups).toHaveLength(5); expect(groups[4].start).toBeGreaterThan(5000);
    expect(itemSchema.required).toEqual(['wholeSource', 'groups']);
    expect(itemSchema.additionalProperties).toBe(false); expect(itemSchema.properties.groups.additionalProperties).toBe(false);
    expect(itemSchema.properties.groups.required).toEqual(researchSectionInventory(input.content).map(section => section.id));
    expect(schema.$defs).toEqual(baseline.$defs);
    expect(schema.$defs.sourceAssessment.properties.additionalIdeas).not.toHaveProperty('maxItems');
    expect(metadata).not.toHaveProperty('content'); expect(metadata).not.toHaveProperty('excerpt');
    expect(Object.values(metadata.groups).every(group => !Object.hasOwn(group, 'content') && !Object.hasOwn(group, 'passages'))).toBe(true);
    expect(metadata.passages.map(passage => passage.text).join('').replace(/\s/g, '')).toBe(input.content.replace(/\s/g, ''));
    expect(metadata.depth).toEqual({ version: RESEARCH_SOURCE_DEPTH_VERSION, bodyHash: await researchHash(input.content),
      catalogHash: await researchHash(JSON.stringify(metadata.passages)), groupsHash: await researchHash(JSON.stringify(metadata.groups)) });
    expect(RESEARCH_SOURCE_DEPTH_INSTRUCTIONS).toContain('EVERY supplied group key required');
    expect(RESEARCH_SOURCE_DEPTH_INSTRUCTIONS).toContain('not an acceptance quota');
  });

  it('reports a missing late group without dropping earlier valid assessments', async () => {
    const { input, groups, raw } = await fixture();
    delete raw.findings[input.id].groups[groups[4].id];
    const result = await normalizeResearchSourceDepth(raw, [input], profiles);
    expect(result.findings.filter(finding => finding.score >= 70)).toHaveLength(4);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: input.id, groupId: groups[4].id, reason: expect.stringContaining('Missing or malformed required') })]));
    expect(result.findings.every(finding => finding.itemId === input.id)).toBe(true);
    expect(result.bindings[0].canonicalURL).toBe(input.url);
  });

  it('keeps a multi-quote compound whole core with unchanged claims, score and separate literal proof', async () => {
    const { input, metadata, groups, raw } = await fixture();
    const ids = [groups[0].selectablePassageIds[0], groups[4].selectablePassageIds[0]];
    const whole = assessment(frame(ids, 'whole-compound-choice'));
    whole.claim.summary = 'The publisher compares early channel choices with the tool handoff and operating limits in the fifth finding.';
    raw.findings[input.id].wholeSource = whole;
    const expected = await normalizeResearchSourceReview({ findings: { [input.id]: whole } }, [{ ...input, passages: metadata.passages }], profiles);
    const result = await normalizeResearchSourceDepth(raw, [input], profiles), proof = result.proofs[0];
    expect(result.findings[0]).toEqual(expected.findings[0]); expect(result.findings[0].score).toBe(92);
    expect(proof).toMatchObject({ itemId: input.id, groupId: null, evidencePassageIds: ids, groupsHash: metadata.depth.groupsHash,
      bodyHash: metadata.depth.bodyHash, catalogHash: metadata.depth.catalogHash, depthVersion: RESEARCH_SOURCE_DEPTH_VERSION });
    expect(proof.passages.map(passage => passage.text)).toEqual(ids.map(id => metadata.passages[id].text));
    for (const passage of proof.passages) expect(input.content.slice(passage.start, passage.end)).toBe(passage.text);
  });

  it('requires a passing group citation anchor in its own focus while allowing separate contextual support', async () => {
    const { input, groups, raw } = await fixture();
    const context = groups[0].selectablePassageIds[0], focal = groups[4].selectablePassageIds[0];
    raw.findings[input.id].groups[groups[4].id] = assessment(frame([context, focal], 'late-borrowed-anchor'));
    let result = await normalizeResearchSourceDepth(raw, [input], profiles);
    expect(result.findings.some(finding => finding.familyKey === 'late-borrowed-anchor')).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ groupId: groups[4].id, reason: expect.stringContaining('first literal citation anchor') })]));
    raw.findings[input.id].groups[groups[4].id] = assessment(frame([focal, context], 'late-own-anchor'));
    result = await normalizeResearchSourceDepth(raw, [input], profiles);
    expect(result.proofs.find(proof => proof.familyKey === 'late-own-anchor')).toMatchObject({ evidencePassageIds: [focal, context], focalPassageIds: [focal] });
    expect(result.findings.find(finding => finding.familyKey === 'late-own-anchor')!.score).toBe(92);
  });

  it('allows every negative group to reject and requires a reason for each rejected frame', async () => {
    const { input, groups, raw } = await fixture();
    for (const group of groups) raw.findings[input.id].groups[group.id] = assessment(frame([], '', true));
    let result = await normalizeResearchSourceDepth(raw, [input], profiles);
    expect(result.findings.filter(finding => finding.score >= 70)).toEqual([]); expect(result.diagnostics).toEqual([]);
    expect(result.findings).toHaveLength(6);
    raw.findings[input.id].groups[groups[2].id].claim.limitations = '';
    result = await normalizeResearchSourceDepth(raw, [input], profiles);
    expect(result.findings.filter(finding => finding.score >= 70)).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ groupId: groups[2].id, reason: expect.stringContaining('explicit reason') })]));
  });

  it('uses existing windows for long unnumbered sources and empty groups for short sources', async () => {
    const long = source('long', Array.from({ length: 20 }, (_, n) => `Paragraph ${n}: a practitioner documents the request, decision and implementation handoff. `.repeat(8)).join('\n\n'));
    const metadata = await researchSourceDepthRequestMetadata(long);
    expect(Object.keys(metadata.groups)).toEqual(researchEvidenceWindows(long.content).map(window => window.id));
    expect(Object.values(metadata.groups).every(group => group.kind === 'captured_window' && group.title === null)).toBe(true);
    const short = source('short', 'A practitioner describes a bounded decision and its handoff. '.repeat(10));
    const shortMetadata = await researchSourceDepthRequestMetadata(short), schema = researchSourceDepthSchema(short, profiles);
    expect(shortMetadata.groups).toEqual({}); expect(schema.properties.findings.properties.short.properties.groups.required).toEqual([]);
    const raw = { findings: { short: { wholeSource: assessment(frame([shortMetadata.passages.find(passage => passage.selectable)!.passageId], 'short-core')), groups: {} } } };
    expect((await normalizeResearchSourceDepth(raw, [short], profiles)).findings).toHaveLength(1);
  });

  it('keeps first whole-source claims by source and family without mixing different group evidence', async () => {
    const { input, groups, raw } = await fixture();
    raw.findings[input.id].wholeSource = assessment(frame([groups[0].selectablePassageIds[0]], 'Same Family'));
    const duplicate = assessment(frame([groups[1].selectablePassageIds[0]], 'same-family'));
    duplicate.profileChecks[0].relevance = 30; duplicate.claim.summary = 'A later higher-scored wording must not overwrite the first actual claim.';
    raw.findings[input.id].groups[groups[1].id] = duplicate;
    const other = source('other', input.content), result = await normalizeResearchSourceDepth({ findings: {
      ...raw.findings, other: { wholeSource: raw.findings[input.id].wholeSource, groups: raw.findings[input.id].groups },
    } }, [input, other], profiles);
    expect(result.findings.filter(finding => finding.familyKey === 'Same Family')).toHaveLength(2);
    expect(result.findings.filter(finding => finding.familyKey === 'Same Family').every(finding => finding.score === 92)).toBe(true);
    expect(result.findings.some(finding => finding.familyKey === 'same-family')).toBe(false);
    expect(result.proofs.filter(proof => proof.familyKey === 'Same Family').every(proof => proof.evidencePassageIds[0] === groups[0].selectablePassageIds[0])).toBe(true);
  });

  it('rejects altered body/catalog/group bindings while retaining independently valid sources', async () => {
    const { input, metadata, raw } = await fixture();
    const changed = { ...input, ...metadata, depth: { ...metadata.depth, bodyHash: 'forged' } };
    let result = await normalizeResearchSourceDepth(raw, [changed], profiles);
    expect(result.findings).toEqual([]); expect(result.diagnostics[0].reason).toContain('binding changed');
    const badGroup = { ...input, ...metadata, groups: structuredClone(metadata.groups) };
    Object.values(badGroup.groups)[0].end--;
    result = await normalizeResearchSourceDepth(raw, [badGroup], profiles);
    expect(result.findings).toEqual([]);
    const { input: good, raw: valid } = await fixture(source('valid'));
    result = await normalizeResearchSourceDepth({ findings: { ...raw.findings, ...valid.findings } }, [changed, good], profiles);
    expect(result.findings.some(finding => finding.itemId === good.id && finding.score >= 70)).toBe(true);
    expect(result.findings.some(finding => finding.itemId === input.id)).toBe(false);
  });
});
