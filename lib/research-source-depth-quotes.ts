import { researchHash } from './research-model';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import {
  RESEARCH_SOURCE_DEPTH_INSTRUCTIONS, RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS,
  normalizeResearchSourceDepth, researchSourceDepthRequestMetadata, researchSourceDepthSchema,
  type ResearchSourceDepthSource, type ResearchSourceDepthGroup,
} from './research-source-depth-model';
import {
  normalizeResearchSourceReview, researchSourceReviewPassages,
  type ResearchSourceReviewDiagnostic, type ResearchSourceReviewProof, type ResearchSourceReviewResult,
} from './research-source-review-model';
import type { ResearchSourceReviewPolicy } from './research-source-review';

export const RESEARCH_SOURCE_DEPTH_QUOTES_VERSION = 'research-source-depth-quotes-v2';
export const RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION = 'literal-attributed-quotes-v1';
const quoteInstructions = `

Some required groups have kind attributed_quote: one literal quoted argument and its explicit named attribution, with original source offsets. Assess EACH attributed argument independently, even when nearby speakers discuss related themes. Identify that speaker's actual distinction, rationale or described practice in the selected summary, angle and why; do not replace the argument with a broad event/role/theme summary. Keep different arguments separate unless the source itself connects them into one coherent core. An attributed reasoned position does not require outcome measurements; causal outcomes still require evidence. A short quotation may also be too vague or promotional to support a useful core: reject it with an explicit reason rather than manufacturing a method. All unchanged profile, categorical quality and own-source focal-anchor rules apply. Quote groups supplement the existing numbered sections or physical windows in this SAME assessment call; they are not new sources or an acceptance quota.`;
export const RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS = RESEARCH_SOURCE_DEPTH_INSTRUCTIONS + quoteInstructions;
export const RESEARCH_SOURCE_DEPTH_QUOTES_SONNET_INSTRUCTIONS = RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS + quoteInstructions;

export type ResearchSourceQuoteDepthGroup = Omit<ResearchSourceDepthGroup, 'kind'> & {
  kind: ResearchSourceDepthGroup['kind'] | 'attributed_quote';
  attribution?: { start: number; end: number };
  rangeHash: string;
};
export type ResearchSourceQuoteDepthBinding = {
  version: typeof RESEARCH_SOURCE_DEPTH_QUOTES_VERSION;
  groupingVersion: typeof RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION;
  bodyHash: string; catalogHash: string; groupsHash: string; rangesHash: string;
};
export type ResearchSourceQuoteDepthProof = ResearchSourceReviewProof & {
  depthVersion: typeof RESEARCH_SOURCE_DEPTH_QUOTES_VERSION;
  groupingVersion: typeof RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION;
  groupsHash: string; rangesHash: string; rangeHash: string | null;
  groupId: string | null; focalPassageIds: number[];
};
export type ResearchSourceQuoteDepthResult = Omit<ResearchSourceReviewResult, 'proofs' | 'diagnostics'> & {
  proofs: ResearchSourceQuoteDepthProof[];
  diagnostics: Array<ResearchSourceReviewDiagnostic & { groupId: string | null }>;
  bindings: Array<ResearchSourceQuoteDepthBinding & { itemId: string; canonicalURL: string | null }>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const family = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const anonymous = /^(?:An?|The|Anonymous|Unknown|Attendee|Participant|Reader|Customer|Survey|Event|Conference)\b/i;
type QuoteRange = Omit<ResearchSourceQuoteDepthGroup, 'rangeHash' | 'selectablePassageIds'>;

export function researchAttributedQuoteRanges(content: string): QuoteRange[] {
  // Require a balanced literal quotation immediately followed by a named dash attribution.
  const quoted = /(?:“([^“”]{20,})”|"([^"\r\n]{20,})")[\t \r\n]*(?:—|–|--)[\t ]*(\p{Lu}[\p{L}\p{M}'’.-]+(?:[\t ]+\p{Lu}[\p{L}\p{M}'’.-]+){1,3})(?=[\t ]*(?:,|\r?\n|[“"]|$))/gu;
  const groups: QuoteRange[] = [];
  for (const match of content.matchAll(quoted)) {
    const name = match[3];
    if (anonymous.test(name) || (match[1] ?? match[2]).trim().length < 20) continue;
    const start = match.index, end = start + match[0].length;
    const attributionStart = end - name.length;
    groups.push({ id: `quote-${start}-${end}`, kind: 'attributed_quote', title: name,
      start, bodyStart: start, end, attribution: { start: attributionStart, end } });
  }
  return groups;
}
function quoteGroups(source: ResearchSourceDepthSource) {
  const passages = researchSourceReviewPassages(source.content);
  return researchAttributedQuoteRanges(source.content).map(group => ({ ...group,
    selectablePassageIds: passages.filter(passage => passage.selectable && passage.start < group.end && passage.end > group.bodyStart
      && source.content.slice(Math.max(passage.start, group.bodyStart), Math.min(passage.end, group.end)).trim().length >= 20).map(passage => passage.passageId),
  }));
}

export function researchSourceQuoteDepthSchema(source: ResearchSourceDepthSource, profileIds: string[]) {
  const schema = researchSourceDepthSchema(source, profileIds), item = schema.properties.findings.properties[source.id];
  const ids = [...item.properties.groups.required, ...quoteGroups(source).map(group => group.id)];
  return { ...schema, properties: { ...schema.properties, findings: { ...schema.properties.findings, properties: {
    [source.id]: { ...item, properties: { ...item.properties, groups: { ...item.properties.groups,
      required: ids, properties: Object.fromEntries(ids.map(id => [id, { $ref: '#/$defs/sourceAssessment' }])),
    } } },
  } } } };
}

export async function researchSourceQuoteDepthRequestMetadata(source: ResearchSourceDepthSource) {
  const baseline = await researchSourceDepthRequestMetadata(source);
  const ranges = [...Object.values(baseline.groups), ...quoteGroups(source)];
  const pairs = await Promise.all(ranges.map(async group => [group.id, { ...group,
    rangeHash: await researchHash(JSON.stringify({ kind: group.kind, start: group.start, bodyStart: group.bodyStart, end: group.end,
      ...('attribution' in group ? { attribution: group.attribution } : {}) })),
  }] as const));
  const groups: Record<string, ResearchSourceQuoteDepthGroup> = Object.fromEntries(pairs);
  const rangesHash = await researchHash(JSON.stringify(Object.values(groups).map(group => ({ id: group.id, rangeHash: group.rangeHash }))));
  const depth: ResearchSourceQuoteDepthBinding = { version: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION,
    groupingVersion: RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION, bodyHash: baseline.depth.bodyHash,
    catalogHash: baseline.depth.catalogHash, groupsHash: await researchHash(JSON.stringify(groups)), rangesHash };
  return { ...baseline, groups, depth };
}

export async function normalizeResearchSourceQuoteDepth(raw: unknown, sources: ResearchSourceDepthSource[], profileIds: string[]): Promise<ResearchSourceQuoteDepthResult> {
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Source depth requires unique original source IDs');
  await normalizeResearchSourceReview({ findings: {} }, [], profileIds);
  const result: ResearchSourceQuoteDepthResult = { findings: [], proofs: [], diagnostics: [], bindings: [] };
  const fail = (itemId: string | null, groupId: string | null, reason: string, rawIdea: unknown, ideaIndex: number | null = null) =>
    result.diagnostics.push({ itemId, groupId, reason, rawIdea, ideaIndex });
  if (!object(raw) || !object(raw.findings) || Object.keys(raw).some(key => key !== 'findings')) {
    fail(null, null, 'Source depth requires the source-keyed findings object', raw); return result;
  }
  for (const id of Object.keys(raw.findings)) if (!sources.some(source => source.id === id)) fail(id, null, 'Unknown original source ID', raw.findings[id]);
  for (const source of sources) {
    const { passages, groups, depth } = await researchSourceQuoteDepthRequestMetadata(source);
    result.bindings.push({ ...depth, itemId: source.id, canonicalURL: typeof source.url === 'string' ? source.url : null });
    if (source.passages !== undefined && stable(source.passages) !== stable(passages)
      || source.groups !== undefined && stable(source.groups) !== stable(groups)
      || source.depth !== undefined && stable(source.depth) !== stable(depth)) {
      fail(source.id, null, 'Source body/catalog/groups binding changed', raw.findings[source.id]); continue;
    }
    const wrapper = raw.findings[source.id];
    if (!object(wrapper)) { fail(source.id, null, 'Missing or malformed source depth assessment', wrapper); continue; }
    for (const key of Object.keys(wrapper)) if (!['wholeSource', 'groups'].includes(key)) fail(source.id, null, 'Unknown depth field: ' + key, wrapper[key]);
    const grouped = object(wrapper.groups) ? wrapper.groups : {};
    if (!object(wrapper.groups)) fail(source.id, null, 'Required groups must be an object', wrapper.groups);
    for (const id of Object.keys(grouped)) if (!Object.hasOwn(groups, id)) fail(source.id, id, 'Unknown factual focus group', grouped[id]);
    const { groups: _groups, depth: _depth, ...captured } = source;
    const baseline = await researchSourceDepthRequestMetadata(captured);
    const prior = await normalizeResearchSourceDepth({ findings: { [source.id]: { wholeSource: wrapper.wholeSource,
      groups: Object.fromEntries(Object.keys(baseline.groups).filter(id => Object.hasOwn(grouped, id)).map(id => [id, grouped[id]])),
    } } }, [captured], profileIds);
    result.findings.push(...prior.findings); result.diagnostics.push(...prior.diagnostics);
    const proofFor = (proof: ResearchSourceReviewProof, groupId: string | null, focalPassageIds: number[]): ResearchSourceQuoteDepthProof => ({
      ...proof, depthVersion: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, groupingVersion: depth.groupingVersion,
      groupsHash: depth.groupsHash, rangesHash: depth.rangesHash, rangeHash: groupId ? groups[groupId].rangeHash : null,
      groupId, focalPassageIds,
    });
    for (const proof of prior.proofs) result.proofs.push(proofFor(proof, proof.groupId, proof.focalPassageIds));
    const seen = new Set(prior.findings.map(finding => family(finding.familyKey)).filter(Boolean));
    const frames = (value: unknown) => object(value) ? 1 + (Array.isArray(value.additionalIdeas) ? value.additionalIdeas.length : 0) : 0;
    let ideaIndex = frames(wrapper.wholeSource) + Object.keys(baseline.groups).reduce((count, id) => count + frames(grouped[id]), 0);
    for (const group of Object.values(groups).filter(group => group.kind === 'attributed_quote')) {
      const value = grouped[group.id];
      if (!object(value)) { fail(source.id, group.id, 'Missing or malformed required ' + group.id + ' assessment', value); continue; }
      const { additionalIdeas, ...primary } = value;
      if (!Array.isArray(additionalIdeas)) fail(source.id, group.id, 'additionalIdeas must be an array', additionalIdeas);
      for (const frame of [primary, ...(Array.isArray(additionalIdeas) ? additionalIdeas : [])]) {
        const index = ideaIndex++;
        if (object(frame) && Object.hasOwn(frame, 'additionalIdeas')) { fail(source.id, group.id, 'Nested additionalIdeas are not permitted', frame, index); continue; }
        const normalized = await normalizeResearchSourceReview({ findings: { [source.id]: object(frame) ? { ...frame, additionalIdeas: [] } : frame } }, [{ ...captured, passages }], profileIds);
        for (const diagnostic of normalized.diagnostics) fail(source.id, group.id, diagnostic.reason, diagnostic.rawIdea, index);
        const finding = normalized.findings[0], proof = normalized.proofs[0];
        if (!finding || !proof) continue;
        const focal = proof.evidencePassageIds.filter(id => group.selectablePassageIds.includes(id));
        if (finding.score >= RESEARCH_POST_MIN_SCORE && (!focal.length || !group.selectablePassageIds.includes(proof.evidencePassageIds[0]))) {
          fail(source.id, group.id, 'Passing group frame requires its first literal citation anchor in its own focus body', frame, index); continue;
        }
        if (finding.score < RESEARCH_POST_MIN_SCORE && !finding.limitations.trim()) {
          fail(source.id, group.id, 'Rejected group frame requires an explicit reason in limitations', frame, index); continue;
        }
        const key = family(finding.familyKey);
        if (key && seen.has(key)) { fail(source.id, group.id, 'Duplicate source idea family; first whole/group claim retained', frame, index); continue; }
        if (key) seen.add(key);
        result.findings.push(finding); result.proofs.push(proofFor({ ...proof, ideaIndex: index }, group.id, focal));
      }
    }
  }
  return result;
}

export const researchSourceDepthQuotePolicy: ResearchSourceReviewPolicy = {
  version: RESEARCH_SOURCE_DEPTH_QUOTES_VERSION, instructions: RESEARCH_SOURCE_DEPTH_QUOTES_INSTRUCTIONS,
  sourceSchema: researchSourceQuoteDepthSchema,
  requestMetadata: async source => { const { groups, depth } = await researchSourceQuoteDepthRequestMetadata(source); return { groups, depth }; },
  normalize: normalizeResearchSourceQuoteDepth,
};
