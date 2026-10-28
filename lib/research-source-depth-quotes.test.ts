import { describe, expect, it } from 'vitest';
import { researchHash } from './research-model';
import { normalizeResearchSourceReview } from './research-source-review-model';
import { normalizeResearchSourceDepth, researchSourceDepthRequestMetadata, researchSourceDepthSchema, RESEARCH_SOURCE_DEPTH_VERSION } from './research-source-depth-model';
import {
  RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION,
  RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS, researchAttributedQuoteRanges, researchSourceQuoteDepthSchema,
  researchSourceQuoteDepthRequestMetadata, normalizeResearchSourceQuoteDepth, researchSourceDepthQuotePolicy,
} from './research-source-depth-quotes';

const profiles = ['personal'];
const first = 'A reviewer should record the unresolved assumption before handing the decision to the implementer. '.repeat(8).trim();
const second = 'When a team compares alternatives, it should state the constraint that rules an attractive option out. '.repeat(8).trim();
const third = 'A workflow can reduce ambiguity by making the owner and the next observable action explicit. '.repeat(8).trim();
const content = 'A publisher collects three attributed practitioner arguments.\n\n'
  + Array.from({ length: 14 }, (_, n) => `Context ${n}: the publisher describes the decision and the surrounding work. `).join('')
  + `\n\n“${first}” — Alex Rivera, Example Studio\n\n“${second}” — Morgan Lee, Example Lab\n\n"${third}" -- Priya Shah, Example Team\n\n`
  + 'Additional context remains in the original physical windows. '.repeat(40);
const source = (id = 'source', text = content) => ({ id, url: 'https://publisher.example/collection', content: text, contentProvenance: 'article', publishedAt: null });
function frame(ids: number[], key: string, rejected = false) {
  return { claimBasis: rejected ? 'no_useful_core' : 'reasoned_position',
    profileChecks: [{ profileId: 'personal', fits: !rejected, relevance: rejected ? 0 : 25, reason: rejected ? 'No supported independent decision.' : 'An attributed product-team decision rule.' }],
    claim: { summary: rejected ? 'No independent useful core.' : 'A practitioner argues that a reviewer should preserve the decision constraint at handoff.', evidencePassageIds: ids,
      contentAngle: rejected ? '' : 'Inspect the recorded constraint before handing the choice to implementation.', whyItMatters: rejected ? '' : 'The distinction changes how the implementer handles ambiguity.',
      limitations: rejected ? 'No additional supported decision in this focus group.' : 'An attributed argument, not measured improvement.' },
    familyKey: key, qualityComponents: { sourceSupport: rejected ? 'unsupported' : 'supported_bounded_claim', usefulDecision: rejected ? 'none' : 'concrete_decision', scopeHonesty: 'accurately_bounded' }, additionalIdeas: [],
  };
}
async function fixture(input = source()) {
  const metadata = await researchSourceQuoteDepthRequestMetadata(input);
  const groups = Object.values(metadata.groups), quotes = groups.filter(group => group.kind === 'attributed_quote');
  const raw = { findings: { [input.id]: { wholeSource: frame([], '', true), groups: Object.fromEntries(groups.map(group => [group.id, frame([], '', true)])) } } };
  return { input, metadata, groups, quotes, raw };
}

describe('versioned attributed-quote focus in the existing depth call', () => {
  it('supplements every old focus range with separate literal named arguments and binds their original ranges', async () => {
    const { input, metadata, groups, quotes } = await fixture();
    const old = await researchSourceDepthRequestMetadata(input), schema = researchSourceQuoteDepthSchema(input, profiles);
    expect(input.content.length).toBeGreaterThan(5000); expect(Object.keys(old.groups).length).toBeGreaterThan(0);
    expect(quotes).toHaveLength(3); expect(quotes.map(group => group.title)).toEqual(['Alex Rivera', 'Morgan Lee', 'Priya Shah']);
    expect(groups.map(group => group.id)).toEqual([...Object.keys(old.groups), ...quotes.map(group => group.id)]);
    for (const prior of Object.values(old.groups)) {
      const { rangeHash, ...unchanged } = metadata.groups[prior.id]; expect(unchanged).toEqual(prior); expect(rangeHash).toMatch(/^[a-f0-9]{64}$/);
    }
    for (const quote of quotes) {
      expect(quote.selectablePassageIds.length).toBeGreaterThan(0);
      expect(input.content.slice(quote.attribution!.start, quote.attribution!.end)).toBe(quote.title);
      expect(input.content.slice(quote.start, quote.end)).toMatch(/^(?:“|")/);
      expect(quote.rangeHash).toMatch(/^[a-f0-9]{64}$/); expect(quote.end).toBe(quote.attribution!.end);
    }
    expect(metadata.passages).toEqual(old.passages); expect(metadata).not.toHaveProperty('content');
    expect(groups.every(group => !Object.hasOwn(group, 'content') && !Object.hasOwn(group, 'passages'))).toBe(true);
    expect(metadata.depth).toMatchObject({ version: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, groupingVersion: RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION,
      bodyHash: await researchHash(input.content), catalogHash: old.depth.catalogHash, groupsHash: await researchHash(JSON.stringify(metadata.groups)) });
    expect(metadata.depth.rangesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(schema.properties.findings.properties[input.id].properties.groups.required).toEqual(groups.map(group => group.id));
    expect(schema.$defs).toEqual(researchSourceDepthSchema(input, profiles).$defs);
    expect(RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS).toContain('not an acceptance quota');
    expect(researchSourceDepthQuotePolicy.version).toBe(RESEARCH_SOURCE_DEPTH_QUOTES_VERSION);
    expect(await researchSourceDepthQuotePolicy.requestMetadata!({ ...input, passages: metadata.passages })).toEqual({ groups: metadata.groups, depth: metadata.depth });
  });

  it('does not guess anonymous, unattributed, nested, unbalanced or too-short quotations', () => {
    const invalid = [
      '“A long argument with no named attribution remains ordinary source context.”',
      '“A long comment attributed to an anonymous person stays ordinary context.” — An Attendee',
      '“A long comment attributed to an anonymous person stays ordinary context.” — Anonymous Contributor',
      '“Short.” — Alex Rivera',
      '“An unclosed long argument from a source. — Alex Rivera',
      '“An outer argument with “nested quoted words” in its body.” — Alex Rivera',
      '“A quoted argument that is followed by prose before attribution.” This is commentary. — Alex Rivera',
    ].join('\n\n');
    expect(researchAttributedQuoteRanges(invalid)).toEqual([]);
    const unicode = '😀 “A reviewer preserves the actual constraint before handing a decision to implementation.” — Élodie Martín, Example Lab';
    const [range] = researchAttributedQuoteRanges(unicode);
    expect(range.title).toBe('Élodie Martín'); expect(range.start).toBe(unicode.indexOf('“'));
    expect(unicode.slice(range.attribution!.start, range.attribution!.end)).toBe(range.title);
  });

  it('keeps v1 metadata, schema and stored-source normalization byte-identical and rejects cross-version bindings', async () => {
    const input = source(), oldMetadata = await researchSourceDepthRequestMetadata(input), oldSchema = researchSourceDepthSchema(input, profiles);
    const oldRaw = { findings: { [input.id]: { wholeSource: frame([], '', true), groups: Object.fromEntries(Object.values(oldMetadata.groups).map((group, n) => [group.id, frame([group.selectablePassageIds[0]], 'old-' + n)])) } } };
    const oldResult = await normalizeResearchSourceDepth(oldRaw, [{ ...input, ...oldMetadata }], profiles);
    expect(oldResult.diagnostics).toEqual([]); expect(oldResult.proofs.every(proof => proof.depthVersion === RESEARCH_SOURCE_DEPTH_VERSION)).toBe(true);
    const frozen = JSON.stringify({ metadata: oldMetadata, schema: oldSchema, result: oldResult });
    const newer = await fixture(input); await normalizeResearchSourceQuoteDepth(newer.raw, [{ ...input, ...newer.metadata }], profiles);
    expect(JSON.stringify({ metadata: await researchSourceDepthRequestMetadata(input), schema: researchSourceDepthSchema(input, profiles),
      result: await normalizeResearchSourceDepth(oldRaw, [{ ...input, ...oldMetadata }], profiles) })).toBe(frozen);
    const wrong = await normalizeResearchSourceQuoteDepth(newer.raw, [{ ...input, ...oldMetadata }], profiles);
    expect(wrong.findings).toEqual([]); expect(wrong.diagnostics[0].reason).toContain('binding changed');
    const oldRejectsNew = await normalizeResearchSourceDepth(oldRaw, [{ ...input, ...newer.metadata }], profiles);
    expect(oldRejectsNew.findings).toEqual([]); expect(oldRejectsNew.diagnostics[0].reason).toContain('binding changed');
  });

  it('independently grades each quote with the unchanged rubric and keeps exact own-source passage proofs', async () => {
    const { input, metadata, quotes, raw } = await fixture();
    for (const [n, quote] of quotes.entries()) raw.findings[input.id].groups[quote.id] = frame([quote.selectablePassageIds[0]], 'quote-core-' + n);
    const result = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.diagnostics).toEqual([]);
    const passing = result.findings.filter(finding => finding.score >= 70); expect(passing).toHaveLength(3);
    for (const [n, quote] of quotes.entries()) {
      const expected = await normalizeResearchSourceReview({ findings: { [input.id]: raw.findings[input.id].groups[quote.id] } }, [{ ...input, passages: metadata.passages }], profiles);
      const finding = passing[n], proof = result.proofs.find(proof => proof.familyKey === finding.familyKey)!;
      expect(finding).toEqual(expected.findings[0]); expect(finding.score).toBe(95);
      expect(proof).toMatchObject({ depthVersion: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, groupingVersion: RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION,
        bodyHash: metadata.depth.bodyHash, catalogHash: metadata.depth.catalogHash, groupsHash: metadata.depth.groupsHash, rangesHash: metadata.depth.rangesHash,
        rangeHash: quote.rangeHash, groupId: quote.id, focalPassageIds: [quote.selectablePassageIds[0]] });
      for (const passage of proof.passages) expect(input.content.slice(passage.start, passage.end)).toBe(passage.text);
    }
  });

  it('rejects a borrowed first anchor, retains valid siblings and reports missing required quote groups', async () => {
    const { input, metadata, quotes, raw } = await fixture();
    const foreign = quotes[2].selectablePassageIds.find(id => !quotes[0].selectablePassageIds.includes(id))!;
    expect(foreign).toBeDefined();
    raw.findings[input.id].groups[quotes[0].id] = frame([foreign, quotes[0].selectablePassageIds[0]], 'borrowed-anchor');
    raw.findings[input.id].groups[quotes[1].id] = frame([quotes[1].selectablePassageIds[0]], 'valid-sibling');
    delete raw.findings[input.id].groups[quotes[2].id];
    const result = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.findings.filter(finding => finding.score >= 70).map(finding => finding.familyKey)).toEqual(['valid-sibling']);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: quotes[0].id, reason: expect.stringContaining('first literal citation anchor') }),
      expect.objectContaining({ groupId: quotes[2].id, reason: expect.stringContaining('Missing or malformed required') }),
    ]));
  });

  it('permits every focus to reject, enforces its explicit reason and preserves valid independent additional frames', async () => {
    const { input, metadata, quotes, groups, raw } = await fixture();
    let result = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.diagnostics).toEqual([]); expect(result.findings).toHaveLength(groups.length + 1);
    expect(result.findings.every(finding => finding.score < 70)).toBe(true);
    raw.findings[input.id].groups[quotes[0].id].claim.limitations = '';
    const { additionalIdeas: _additional, ...selected } = frame([quotes[1].selectablePassageIds[0]], 'valid-additional');
    raw.findings[input.id].groups[quotes[1].id].additionalIdeas = [selected] as never;
    result = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.findings.filter(finding => finding.score >= 70).map(finding => finding.familyKey)).toEqual(['valid-additional']);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ groupId: quotes[0].id, reason: expect.stringContaining('explicit reason') })]));
  });

  it('binds quote range changes and keeps existing whole-source family precedence without changing scores', async () => {
    const { input, metadata, quotes, raw } = await fixture();
    raw.findings[input.id].wholeSource = frame([quotes[0].selectablePassageIds[0]], 'same-family');
    raw.findings[input.id].groups[quotes[0].id] = frame([quotes[0].selectablePassageIds[0]], 'Same Family');
    const result = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...metadata }], profiles);
    expect(result.findings.filter(finding => finding.score >= 70).map(finding => finding.familyKey)).toEqual(['same-family']);
    expect(result.proofs.find(proof => proof.familyKey === 'same-family')?.rangeHash).toBeNull();
    expect(result.diagnostics.some(diagnostic => diagnostic.reason.includes('Duplicate source idea family'))).toBe(true);
    const changed = structuredClone(metadata); changed.groups[quotes[0].id].end--;
    const rejected = await normalizeResearchSourceQuoteDepth(raw, [{ ...input, ...changed }], profiles);
    expect(rejected.findings).toEqual([]); expect(rejected.diagnostics[0].reason).toContain('binding changed');
  });
});
