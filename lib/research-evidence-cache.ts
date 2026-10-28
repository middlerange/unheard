import { matchResearchQuote, researchEvidenceSchema, researchHash, validateResearchEvidenceCoverage, validateResearchEvidenceProfiles, type ResearchEvidence } from "./research-model";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";

export type EvidenceCacheInput = { id: string; content?: string; [key: string]: unknown };
export type EvidenceCacheValue = { findings: ResearchEvidence[] };
export type EvidenceCacheContext = {
  teamId: string;
  model: string;
  promptVersion: string;
  system: string;
  audience: unknown;
  selectionViewVersion: string;
  selectionAudience: unknown;
  schemaForItem: (id: string) => Record<string, unknown>;
};
type EvidenceCacheAccess = {
  context: EvidenceCacheContext;
  validate: (value: unknown, items: EvidenceCacheInput[], recordInvalid?: boolean) => Promise<EvidenceCacheValue>;
  write: (id: string, value: EvidenceCacheValue) => Promise<void>;
};

export function validateResearchEvidenceCacheValue(value: unknown, items: EvidenceCacheInput[], enabledProfileIds: string[]) {
  const output = researchEvidenceSchema.parse(value);
  const findings = validateResearchEvidenceCoverage(output.findings, items.map(item => item.id));
  validateResearchEvidenceProfiles(findings, enabledProfileIds);
  const bodies = new Map(items.map(item => [item.id, item.content]));
  for (const primary of findings) {
    for (const idea of [primary, ...(primary.additionalIdeas || [])]) {
      if (idea.score >= RESEARCH_POST_MIN_SCORE && !matchResearchQuote(bodies.get(primary.itemId) || "", idea.evidence))
        throw new Error(`Research evidence has an unsupported passing quote for source ${primary.itemId}`);
    }
  }
  return output;
}

export async function researchEvidenceItemCacheId(context: EvidenceCacheContext, item: EvidenceCacheInput) {
  return `evidence-item:v1:${await researchHash(JSON.stringify([
    context.teamId, context.model, context.promptVersion, context.system,
    context.audience, context.selectionViewVersion, context.selectionAudience,
    context.schemaForItem(item.id), item,
  ]))}`;
}

function individualResponses(value: unknown) {
  if (!value || typeof value !== "object" || !("findings" in value)) return [];
  const findings = (value as { findings: unknown }).findings;
  if (Array.isArray(findings)) return findings.flatMap(finding =>
    finding && typeof finding === "object" && typeof finding.itemId === "string"
      ? [{ itemId: finding.itemId as string, value: { findings: [finding] } }] : []);
  if (findings && typeof findings === "object") return Object.entries(findings).map(([itemId, finding]) => ({
    itemId, value: { findings: { [itemId]: finding } },
  }));
  return [];
}

export async function cacheValidResearchEvidenceItems(
  value: unknown, items: EvidenceCacheInput[], access: EvidenceCacheAccess,
) {
  const candidates = individualResponses(value), counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.itemId, (counts.get(candidate.itemId) || 0) + 1);
  const inputs = new Map(items.map(item => [item.id, item]));
  const valid = new Map<string, ResearchEvidence>();
  for (const candidate of candidates) {
    const item = inputs.get(candidate.itemId);
    if (!item || counts.get(candidate.itemId) !== 1) continue;
    let parsed: EvidenceCacheValue;
    try { parsed = await access.validate(candidate.value, [item], false); }
    catch { continue; }
    const id = await researchEvidenceItemCacheId(access.context, item);
    await access.write(id, parsed);
    valid.set(item.id, parsed.findings[0]);
  }
  return valid;
}

export async function reuseResearchEvidenceItems(
  items: EvidenceCacheInput[],
  access: EvidenceCacheAccess & {
    read: (id: string) => Promise<unknown | null>;
    discard: (id: string, value: unknown, error: unknown) => Promise<void>;
    generate: (items: EvidenceCacheInput[]) => Promise<unknown>;
  },
) {
  if (new Set(items.map(item => item.id)).size !== items.length)
    throw new Error("Research evidence inputs must have unique source IDs");
  const findings = new Map<string, ResearchEvidence>();
  const missing: EvidenceCacheInput[] = [];
  let cacheHits = 0;
  for (const item of items) {
    const id = await researchEvidenceItemCacheId(access.context, item);
    const cached = await access.read(id);
    if (cached !== null) {
      try {
        const parsed = await access.validate(cached, [item], false);
        findings.set(item.id, parsed.findings[0]);
        cacheHits++;
        continue;
      } catch (error) { await access.discard(id, cached, error); }
    }
    missing.push(item);
  }
  if (missing.length) {
    const value = await access.generate(missing);
    // Preserve only complete, independently validated source assessments. The
    // entire response must still pass before any aggregate can be returned.
    await cacheValidResearchEvidenceItems(value, missing, access);
    const parsed = await access.validate(value, missing, true);
    for (const finding of parsed.findings) findings.set(finding.itemId, finding);
  }
  const result = await access.validate({ findings: items.map(item => findings.get(item.id)) }, items, true);
  return { value: result, cacheHits };
}
