import { researchHash } from './research-model';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import { researchSectionInventory } from './research-sections';
import { researchEvidenceWindows } from './research-window-focus';
import {
  normalizeResearchSourceReview, researchSourceReviewPassages, researchSourceReviewSchemaForItems,
  RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS,
  RESEARCH_SOURCE_REVIEW_PIPELINE_VERSION,
  type ResearchSourceReviewPassage, type ResearchSourceReviewResult, type ResearchSourceReviewProof,
  type ResearchSourceReviewDiagnostic,
} from './research-source-review-model';

export const RESEARCH_SOURCE_DEPTH_VERSION = 'research-source-depth-v1';
export const RESEARCH_SOURCE_DEPTH_PIPELINE_VERSION = `${RESEARCH_SOURCE_REVIEW_PIPELINE_VERSION}+depth-v1`;
export const RESEARCH_SOURCE_DEPTH_INSTRUCTIONS = `${RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS}

Return findings keyed by the actual supplied source ID. Each source has wholeSource plus groups, with exactly EVERY supplied group key required. Each value is the unchanged categorical source assessment with its primary claim, evidencePassageIds, profileChecks and unlimited additionalIdeas. The full ordered passage catalog occurs once; groups supply only literal source ranges, titles and focal selectable passage IDs, not separate sources or repeated bodies.

wholeSource may express a coherent comparison or workflow across groups. Independently inspect every group and return all useful cores inside it; do not omit a late group or stop after an early theme. A passing group claim's FIRST evidencePassageId, the legacy citation anchor, must be one of that group's selectablePassageIds. Other selected passages may supply context from elsewhere in this SAME source. Focal passages overlap the actual group body by at least20 trimmed characters; a heading or introduction alone is not focal support. Never reorder quotations or invent a new source ID/URL.

A group may reject every frame. Each rejected group frame must explicitly explain the absence of a supported useful core in limitations, using no_useful_core where appropriate. Required group presence is a coverage requirement, not an acceptance quota. Do not upgrade scores, fabricate missing premises or merge unrelated cores. Keep the same evidence standard, categorical rubric and independent profile decisions.`;

export type ResearchSourceDepthSource = {
  id: string; content: string; passages?: ResearchSourceReviewPassage[]; [key: string]: unknown;
};
export type ResearchSourceDepthGroup = {
  id: string; kind: 'numbered_section' | 'captured_window'; title: string | null;
  start: number; bodyStart: number; end: number; selectablePassageIds: number[];
};
export type ResearchSourceDepthBinding = {
  version: typeof RESEARCH_SOURCE_DEPTH_VERSION; bodyHash: string; catalogHash: string; groupsHash: string;
};
export type ResearchSourceDepthMetadata = Record<string, unknown> & {
  id: string; passages: ResearchSourceReviewPassage[]; groups: Record<string, ResearchSourceDepthGroup>; depth: ResearchSourceDepthBinding;
};
export type ResearchSourceDepthProof = ResearchSourceReviewProof & {
  depthVersion: typeof RESEARCH_SOURCE_DEPTH_VERSION; groupsHash: string; groupId: string | null; focalPassageIds: number[];
};
export type ResearchSourceDepthDiagnostic = ResearchSourceReviewDiagnostic & { groupId: string | null };
export type ResearchSourceDepthResult = Omit<ResearchSourceReviewResult, 'proofs' | 'diagnostics'> & {
  proofs: ResearchSourceDepthProof[]; diagnostics: ResearchSourceDepthDiagnostic[];
  bindings: Array<ResearchSourceDepthBinding & { itemId: string; canonicalURL: string | null }>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const family = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function groupsFor(source: ResearchSourceDepthSource, passages: ResearchSourceReviewPassage[]) {
  const sections = researchSectionInventory(source.content);
  const ranges = sections.length >= 2
    ? sections.map(section => ({ ...section, kind: 'numbered_section' as const }))
    : researchEvidenceWindows(source.content).map(window => ({ ...window, bodyStart: window.start, title: null, kind: 'captured_window' as const }));
  return Object.fromEntries(ranges.map(group => [group.id, { ...group, selectablePassageIds: passages.filter(passage => passage.selectable
    && source.content.slice(Math.max(passage.start, group.bodyStart), Math.min(passage.end, group.end)).trim().length >= 20
    && passage.start < group.end && passage.end > group.bodyStart).map(passage => passage.passageId) }]));
}

export function researchSourceDepthSchema(source: ResearchSourceDepthSource, enabledProfileIds: string[]) {
  const baseline = researchSourceReviewSchemaForItems([source.id], enabledProfileIds);
  const groups = groupsFor(source, researchSourceReviewPassages(source.content));
  const assessment = { $ref: '#/$defs/sourceAssessment' };
  return { ...baseline, properties: { findings: { ...baseline.properties.findings, properties: {
    [source.id]: { type: 'object', additionalProperties: false, properties: {
      wholeSource: assessment,
      groups: { type: 'object', additionalProperties: false, required: Object.keys(groups),
        properties: Object.fromEntries(Object.keys(groups).map(id => [id, assessment])) },
    }, required: ['wholeSource', 'groups'] },
  } } } };
}

export async function researchSourceDepthRequestMetadata(source: ResearchSourceDepthSource): Promise<ResearchSourceDepthMetadata> {
  const passages = researchSourceReviewPassages(source.content), groups = groupsFor(source, passages);
  const [bodyHash, catalogHash, groupsHash] = await Promise.all([
    researchHash(source.content), researchHash(JSON.stringify(passages)), researchHash(JSON.stringify(groups)),
  ]);
  const { content: _content, excerpt: _excerpt, publicText: _publicText, sourceSections: _sections,
    passages: _passages, groups: _groups, depth: _depth, ...metadata } = source;
  return { ...metadata, id: source.id, passages, groups,
    depth: { version: RESEARCH_SOURCE_DEPTH_VERSION, bodyHash, catalogHash, groupsHash } };
}

export async function normalizeResearchSourceDepth(raw: unknown, sources: ResearchSourceDepthSource[], enabledProfileIds: string[]): Promise<ResearchSourceDepthResult> {
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Source depth requires unique original source IDs');
  await normalizeResearchSourceReview({ findings: {} }, [], enabledProfileIds);
  const result: ResearchSourceDepthResult = { findings: [], proofs: [], diagnostics: [], bindings: [] }, seenFamilies = new Set<string>();
  const fail = (itemId: string | null, groupId: string | null, reason: string, rawIdea: unknown, ideaIndex: number | null = null) =>
    result.diagnostics.push({ itemId, groupId, reason, rawIdea, ideaIndex });
  if (!object(raw) || !object(raw.findings) || Object.keys(raw).some(key => key !== 'findings')) {
    fail(null, null, 'Source depth requires the source-keyed findings object', raw); return result;
  }
  for (const id of Object.keys(raw.findings)) if (!sources.some(source => source.id === id)) fail(id, null, 'Unknown original source ID', raw.findings[id]);
  for (const source of sources) {
    const metadata = await researchSourceDepthRequestMetadata(source), { passages, groups, depth } = metadata;
    result.bindings.push({ ...depth, itemId: source.id, canonicalURL: typeof source.url === 'string' ? source.url : null });
    if (source.passages !== undefined && stable(source.passages) !== stable(passages)
      || source.groups !== undefined && stable(source.groups) !== stable(groups)
      || source.depth !== undefined && stable(source.depth) !== stable(depth)) {
      fail(source.id, null, 'Source body/catalog/groups binding changed', raw.findings[source.id]); continue;
    }
    const captured = { ...source, passages }, wrapper = raw.findings[source.id];
    if (!object(wrapper)) { fail(source.id, null, 'Missing or malformed source depth assessment', wrapper); continue; }
    for (const key of Object.keys(wrapper)) if (!['wholeSource', 'groups'].includes(key)) fail(source.id, null, 'Unknown depth field: ' + key, wrapper[key]);
    let ideaIndex = 0;
    async function assessment(value: unknown, group: ResearchSourceDepthGroup | null) {
      if (!object(value)) { fail(source.id, group?.id ?? null, 'Missing or malformed required ' + (group?.id ?? 'wholeSource') + ' assessment', value); return; }
      const { additionalIdeas, ...primary } = value;
      if (!Array.isArray(additionalIdeas)) fail(source.id, group?.id ?? null, 'additionalIdeas must be an array', additionalIdeas);
      for (const frame of [primary, ...(Array.isArray(additionalIdeas) ? additionalIdeas : [])]) {
        const index = ideaIndex++;
        if (object(frame) && Object.hasOwn(frame, 'additionalIdeas')) { fail(source.id, group?.id ?? null, 'Nested additionalIdeas are not permitted', frame, index); continue; }
        const normalized = await normalizeResearchSourceReview({ findings: {
          [source.id]: object(frame) ? { ...frame, additionalIdeas: [] } : frame,
        } }, [captured], enabledProfileIds);
        for (const diagnostic of normalized.diagnostics) fail(source.id, group?.id ?? null, diagnostic.reason, diagnostic.rawIdea, index);
        const finding = normalized.findings[0], proof = normalized.proofs[0];
        if (!finding || !proof) continue;
        const focalPassageIds = group ? proof.evidencePassageIds.filter(id => group.selectablePassageIds.includes(id)) : [];
        if (group && finding.score >= RESEARCH_POST_MIN_SCORE
          && (!focalPassageIds.length || !group.selectablePassageIds.includes(proof.evidencePassageIds[0]))) {
          fail(source.id, group.id, 'Passing group frame requires its first literal citation anchor in its own focus body', frame, index); continue;
        }
        if (group && finding.score < RESEARCH_POST_MIN_SCORE && !finding.limitations.trim()) {
          fail(source.id, group.id, 'Rejected group frame requires an explicit reason in limitations', frame, index); continue;
        }
        const key = family(finding.familyKey), identity = source.id + '\u0000' + key;
        if (key && seenFamilies.has(identity)) { fail(source.id, group?.id ?? null, 'Duplicate source idea family; first whole/group claim retained', frame, index); continue; }
        if (key) seenFamilies.add(identity);
        result.findings.push(finding);
        result.proofs.push({ ...proof, ideaIndex: index, depthVersion: RESEARCH_SOURCE_DEPTH_VERSION,
          groupsHash: depth.groupsHash, groupId: group?.id ?? null, focalPassageIds });
      }
    }
    await assessment(wrapper.wholeSource, null);
    if (!object(wrapper.groups)) fail(source.id, null, 'Required groups must be an object', wrapper.groups);
    const grouped = object(wrapper.groups) ? wrapper.groups : {};
    for (const id of Object.keys(grouped)) if (!Object.hasOwn(groups, id)) fail(source.id, id, 'Unknown factual focus group', grouped[id]);
    for (const group of Object.values(groups)) await assessment(grouped[group.id], group);
  }
  return result;
}
