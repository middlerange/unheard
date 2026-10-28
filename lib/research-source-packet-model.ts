import { evidenceJsonSchemaForItems, researchEvidenceSchema, researchHash, validateResearchEvidence, validateResearchEvidenceProfiles, type ResearchEvidence } from './research-model';
import { RESEARCH_POST_MIN_SCORE } from './research-policy';
import { RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS, researchSourceReviewPassages, type ResearchSourceReviewPassage } from './research-source-review-model';

export const RESEARCH_SOURCE_PACKET_VERSION = 'research-source-packet-v1';
export const RESEARCH_SOURCE_PACKET_INSTRUCTIONS = `${RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS}

Review the explicitly related captured documents as one source packet, preserving each original document's identity. A packet is not a new publisher article. Return findings keyed by packet ID, with one primary assessment and unlimited coherent additionalIdeas. Submit the completed object exactly once through submit_research; do not answer with prose or call another tool.

Each assessment has primarySourceId, evidenceCitations [{sourceId, passageIds}], relationshipSupport, relationshipExplanation, claimBasis, profileChecks, claim, familyKey and categorical qualityComponents. claim contains summary, contentAngle, whyItMatters and limitations. There are no model-authored numeric grades or quotations. Select literal selectable passage IDs from their own document catalogs. The first citation must name the supplied primarySourceId and its first passage is the legacy anchor. Every passing synthesis must use at least two distinct related documents and must need both, rather than adding an unrelated quotation to an otherwise single-document brief.

Use the relationship basis as permission to inspect related sources, not evidence that every capability, deployment, result or causal bridge exists. Same publisher/product/repository is not proof that two capabilities work together. Evaluate the exact necessary bridge. Use documented_relationship only when the cited source text documents that relationship. Use bounded_inference for a plausible but unverified connection; explicitly state inference in limitations and include relationshipExplanation there verbatim. Distinguish connector capability linkage from actual end-to-end deployment proof. If a necessary bridge is unsupported, use unsupported_bridge and reject the core. Do not invent a missing premise to complete a framework or silently transfer one person's actions to another.

Inspectable public artifacts can support a bounded product or growth teardown even when their publisher has not written the lesson for us. Compare the actual behavior, options, access boundaries or handoffs documented across related pages. Keep those observations in the summary and label our proposed implication or test in contentAngle; do not attribute our interpretation to the publisher. Commercial copy does not establish effectiveness, but an observable design choice is not automatically a thin advertisement. A list of benefits without inspectable behavior, a registration invitation without a usable distinction, or an unsupported claim about conversion still does not qualify. Apply the actual profile remit and unchanged evidence standard to the resulting bounded claim.

Keep a single coherent useful core per frame, retain attribution and temporal limits from every source, and keep all supporting citations attached to that frame. A dated source does not give another source a publication date. Unknown dates stay unknown. Reject incomplete or irrelevant packets without an acceptance quota; explain the missing premise in limitations. Preserve the unchanged qualification rubric and independent publishing-profile decisions. Never extract, log or return thinking transport blocks.`;

export type ResearchSourcePacketSource = {
  id: string; url: string; publishedAt: number | null; firstSeen: number | null; content: string;
  passages?: ResearchSourceReviewPassage[];
};
export type ResearchSourcePacketRelationship = {
  type: 'same_publisher' | 'same_product' | 'same_repository' | 'configured_reference';
  reason: string; sourceIds: string[];
};
export type ResearchSourcePacket = {
  id: string; primarySourceId: string; relationship: ResearchSourcePacketRelationship; sources: ResearchSourcePacketSource[];
};
export type ResearchSourcePacketCatalog = Omit<ResearchSourcePacketSource, 'content' | 'passages'> & {
  bodyHash: string; catalogHash: string; passages: ResearchSourceReviewPassage[];
};
export type ResearchSourcePacketMetadata = {
  version: typeof RESEARCH_SOURCE_PACKET_VERSION; id: string; packetHash: string; primarySourceId: string;
  relationship: ResearchSourcePacketRelationship; sources: ResearchSourcePacketCatalog[];
};
export type ResearchSourcePacketCitation = { sourceId: string; passageIds: number[] };
export type ResearchSourcePacketProof = {
  version: typeof RESEARCH_SOURCE_PACKET_VERSION; packetId: string; packetHash: string; primarySourceId: string;
  familyKey: string; ideaIndex: number; relationship: ResearchSourcePacketRelationship;
  relationshipSupport: 'documented_relationship' | 'bounded_inference' | 'unsupported_bridge'; relationshipExplanation: string;
  sources: Array<Omit<ResearchSourcePacketCatalog, 'id' | 'passages'> & {
    sourceId: string; passageIds: number[];
    passages: Array<Pick<ResearchSourceReviewPassage, 'passageId' | 'start' | 'end' | 'text'>>;
  }>;
};
export type ResearchSourcePacketFinding = ResearchEvidence & {
  supportingEvidence: string[]; evidenceCitations: ResearchSourcePacketCitation[];
};
export type ResearchSourcePacketResult = {
  findings: ResearchSourcePacketFinding[]; packetProofs: ResearchSourcePacketProof[];
  diagnostics: Array<{ packetId: string | null; ideaIndex: number | null; reason: string; rawIdea: unknown }>;
  bindings: Array<{ packetId: string; packetHash: string; primarySourceId: string; sources: Array<Omit<ResearchSourcePacketCatalog, 'passages'>> }>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const family = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error(label + ' has missing or unknown fields');
}
function publicURL(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Packet requires original public source URLs');
  return url;
}
function validatePacket(packet: ResearchSourcePacket) {
  if (!packet.id?.trim() || !packet.primarySourceId?.trim() || !Array.isArray(packet.sources) || packet.sources.length < 2) throw new Error('Packet requires an ID, a real primary source and at least two documents');
  const ids = packet.sources.map(source => source.id);
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length || !ids.includes(packet.primarySourceId)) throw new Error('Packet source IDs must be unique and include the real primary source');
  const relation = packet.relationship;
  if (!relation || !['same_publisher', 'same_product', 'same_repository', 'configured_reference'].includes(relation.type)
    || typeof relation.reason !== 'string' || relation.reason.trim().length < 20 || !Array.isArray(relation.sourceIds)
    || relation.sourceIds.length !== ids.length || new Set(relation.sourceIds).size !== ids.length || relation.sourceIds.some(id => !ids.includes(id))) throw new Error('Packet relationship must explicitly bind every original document');
  for (const source of packet.sources) {
    if (typeof source.content !== 'string' || !source.content.trim()) throw new Error('Packet requires actual captured source bodies');
    publicURL(source.url);
    for (const date of [source.publishedAt, source.firstSeen]) if (date !== null && (!Number.isFinite(date) || date < 0 || !Number.isInteger(date))) throw new Error('Packet source dates must be original timestamps or null');
    if (source.passages !== undefined && stable(source.passages) !== stable(researchSourceReviewPassages(source.content))) throw new Error('Packet source catalog changed from its original body');
  }
  if (relation.type === 'same_publisher' && new Set(packet.sources.map(source => publicURL(source.url).hostname.toLowerCase().replace(/^www\./, ''))).size !== 1) throw new Error('Same-publisher relationship does not match the source hosts');
  if (relation.type === 'same_repository') {
    const repositories = packet.sources.map(source => {
      const url = publicURL(source.url), host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
      if (!['github.com', 'raw.githubusercontent.com'].includes(host) || parts.length < 2) throw new Error('Same-repository relationship requires real repository URLs');
      return parts.slice(0, 2).join('/').toLowerCase();
    });
    if (new Set(repositories).size !== 1) throw new Error('Same-repository relationship does not match the source repositories');
  }
}

export async function researchSourcePacketMetadata(packet: ResearchSourcePacket): Promise<ResearchSourcePacketMetadata> {
  validatePacket(packet);
  const sources = await Promise.all(packet.sources.map(async source => {
    const passages = researchSourceReviewPassages(source.content);
    return { id: source.id, url: source.url, publishedAt: source.publishedAt, firstSeen: source.firstSeen,
      bodyHash: await researchHash(source.content), catalogHash: await researchHash(JSON.stringify(passages)), passages };
  }));
  const binding = { version: RESEARCH_SOURCE_PACKET_VERSION, id: packet.id, primarySourceId: packet.primarySourceId,
    relationship: packet.relationship, sources: sources.map(({ passages: _passages, ...source }) => source) } as const;
  return { ...binding, packetHash: await researchHash(stable(binding)), sources };
}

export function researchSourcePacketSchema(packet: ResearchSourcePacket, enabledProfileIds: string[]) {
  validatePacket(packet);
  const baseline = evidenceJsonSchemaForItems([packet.id], enabledProfileIds);
  const { evidence: _evidence, ...claimProperties } = baseline.$defs.claim.properties;
  const properties = { ...baseline.$defs.idea.properties,
    primarySourceId: { type: 'string', enum: [packet.primarySourceId] },
    evidenceCitations: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { sourceId: { type: 'string', enum: packet.sources.map(source => source.id) }, passageIds: { type: 'array', items: { type: 'integer', minimum: 0 } } }, required: ['sourceId', 'passageIds'] } },
    relationshipSupport: { type: 'string', enum: ['documented_relationship', 'bounded_inference', 'unsupported_bridge'] },
    relationshipExplanation: { type: 'string' },
  };
  const required = [...baseline.$defs.idea.required, 'primarySourceId', 'evidenceCitations', 'relationshipSupport', 'relationshipExplanation'];
  return { ...baseline, $defs: { ...baseline.$defs,
    claim: { ...baseline.$defs.claim, properties: claimProperties, required: baseline.$defs.claim.required.filter(name => name !== 'evidence') },
    idea: { ...baseline.$defs.idea, properties, required },
    sourceAssessment: { ...baseline.$defs.sourceAssessment, properties: { ...properties, additionalIdeas: { type: 'array', items: { $ref: '#/$defs/idea' } } }, required: [...required, 'additionalIdeas'] },
  } };
}

export async function normalizeResearchSourcePacket(raw: unknown, packets: ResearchSourcePacket[], enabledProfileIds: string[]): Promise<ResearchSourcePacketResult> {
  if (!enabledProfileIds.length || new Set(enabledProfileIds).size !== enabledProfileIds.length || enabledProfileIds.some(id => !id)) throw new Error('Packet review requires the full unique publishing-profile roster');
  if (new Set(packets.map(packet => packet.id)).size !== packets.length) throw new Error('Packet review requires unique packet IDs');
  const result: ResearchSourcePacketResult = { findings: [], packetProofs: [], diagnostics: [], bindings: [] };
  const fail = (packetId: string | null, ideaIndex: number | null, reason: string, rawIdea: unknown) => result.diagnostics.push({ packetId, ideaIndex, reason, rawIdea });
  if (!object(raw) || !object(raw.findings) || Object.keys(raw).some(key => key !== 'findings')) { fail(null, null, 'Packet review requires packet-keyed findings', raw); return result; }
  for (const id of Object.keys(raw.findings)) if (!packets.some(packet => packet.id === id)) fail(id, null, 'Unknown source packet ID', raw.findings[id]);
  for (const packet of packets) {
    const metadata = await researchSourcePacketMetadata(packet), catalogs = new Map(metadata.sources.map(source => [source.id, source]));
    result.bindings.push({ packetId: packet.id, packetHash: metadata.packetHash, primarySourceId: packet.primarySourceId,
      sources: metadata.sources.map(({ passages: _passages, ...source }) => source) });
    const assessment = raw.findings[packet.id], families = new Set<string>();
    if (!object(assessment)) { fail(packet.id, null, 'Missing or malformed packet assessment', assessment); continue; }
    const { additionalIdeas, ...primary } = assessment;
    if (!Array.isArray(additionalIdeas)) fail(packet.id, null, 'additionalIdeas must be an array', additionalIdeas);
    for (const [ideaIndex, frame] of [primary, ...(Array.isArray(additionalIdeas) ? additionalIdeas : [])].entries()) {
      try {
        if (!object(frame)) throw new Error('Packet idea must be an object');
        exactKeys(frame, ['primarySourceId', 'evidenceCitations', 'relationshipSupport', 'relationshipExplanation', 'claimBasis', 'profileChecks', 'claim', 'familyKey', 'qualityComponents'], 'Packet idea');
        if (frame.primarySourceId !== packet.primarySourceId) throw new Error('Packet idea must anchor to its configured real primary source');
        if (!object(frame.claim)) throw new Error('Packet claim must be an object');
        exactKeys(frame.claim, ['summary', 'contentAngle', 'whyItMatters', 'limitations'], 'Packet claim');
        if (!Array.isArray(frame.profileChecks)) throw new Error('Packet profile checks must use the full enabled-profile array contract');
        if (!['documented_relationship', 'bounded_inference', 'unsupported_bridge'].includes(String(frame.relationshipSupport))
          || typeof frame.relationshipExplanation !== 'string' || frame.relationshipExplanation.trim().length < 20) throw new Error('Packet requires an explicit relationship assessment');
        if (!Array.isArray(frame.evidenceCitations)) throw new Error('Packet requires structured source citations');
        const seenSources = new Set<string>(), citations: ResearchSourcePacketCitation[] = [], proofSources: ResearchSourcePacketProof['sources'] = [];
        for (const citation of frame.evidenceCitations) {
          if (!object(citation)) throw new Error('Packet citation must be an object');
          exactKeys(citation, ['sourceId', 'passageIds'], 'Packet citation');
          if (typeof citation.sourceId !== 'string' || !catalogs.has(citation.sourceId) || seenSources.has(citation.sourceId)) throw new Error('Packet citation names an unknown, unlinked or repeated source');
          const catalog = catalogs.get(citation.sourceId)!;
          if (!Array.isArray(citation.passageIds) || !citation.passageIds.length || citation.passageIds.some(id => !Number.isInteger(id) || id < 0)
            || new Set(citation.passageIds).size !== citation.passageIds.length) throw new Error('Packet passage IDs must be distinct nonnegative integers');
          const selected = citation.passageIds.map(id => catalog.passages[id]);
          const body = packet.sources.find(source => source.id === citation.sourceId)!.content;
          if (selected.some(passage => !passage?.selectable || passage.text !== body.slice(passage.start, passage.end))) throw new Error('Packet citation must select literal selectable passages from its own document');
          seenSources.add(citation.sourceId); citations.push({ sourceId: citation.sourceId, passageIds: [...citation.passageIds] });
          const { id, passages: _catalog, ...binding } = catalog;
          proofSources.push({ ...binding, sourceId: id, passageIds: [...citation.passageIds], passages: selected.map(({ passageId, start, end, text }) => ({ passageId, start, end, text })) });
        }
        if (citations.length && citations[0].sourceId !== packet.primarySourceId) throw new Error('Packet first citation must anchor the real primary document');
        const supportingEvidence = proofSources.flatMap(source => source.passages.map(passage => passage.text));
        const finding = researchEvidenceSchema.parse({ findings: [{ itemId: packet.primarySourceId,
          claimBasis: frame.claimBasis, profileChecks: frame.profileChecks, claim: { ...frame.claim, evidence: supportingEvidence[0] || '' }, familyKey: frame.familyKey, qualityComponents: frame.qualityComponents }] }).findings[0];
        if (finding.qualificationRubric !== 'source_qualification_v1') throw new Error('Packet requires the unchanged categorical qualification rubric');
        validateResearchEvidenceProfiles([finding], enabledProfileIds);
        if (finding.score >= RESEARCH_POST_MIN_SCORE) {
          if (citations.length < 2) throw new Error('Passing packet synthesis requires at least two distinct cited documents');
          if (frame.relationshipSupport === 'unsupported_bridge') throw new Error('Passing packet has an unsupported necessary relationship bridge');
          if (frame.relationshipSupport === 'bounded_inference' && (!/\binferen(?:ce|ces|tial|red)\b/i.test(finding.limitations)
            || !finding.limitations.includes(frame.relationshipExplanation))) throw new Error('Bounded packet inference must be explicit in selected limitations with its relationship explanation');
          if (validateResearchEvidence([finding], [{ id: packet.primarySourceId, content: packet.sources.find(source => source.id === packet.primarySourceId)!.content }]).length !== 1) throw new Error('Packet primary anchor is not literal in the real primary body');
        } else if (!finding.limitations.trim()) throw new Error('Rejected packet must state its missing premise or limitation');
        const key = family(finding.familyKey);
        if (key && families.has(key)) throw new Error('Duplicate packet idea family');
        if (key) families.add(key);
        result.findings.push({ ...finding, supportingEvidence, evidenceCitations: citations });
        result.packetProofs.push({ version: RESEARCH_SOURCE_PACKET_VERSION, packetId: packet.id, packetHash: metadata.packetHash,
          primarySourceId: packet.primarySourceId, familyKey: finding.familyKey, ideaIndex, relationship: packet.relationship,
          relationshipSupport: frame.relationshipSupport as ResearchSourcePacketProof['relationshipSupport'], relationshipExplanation: frame.relationshipExplanation,
          sources: proofSources });
      } catch (error) { fail(packet.id, ideaIndex, error instanceof Error ? error.message : 'Malformed packet idea', frame); }
    }
  }
  return result;
}
