import { matchResearchQuote, researchEvidenceSchema, researchHash, validateResearchEvidenceCoverage, validateResearchEvidenceProfiles, type ResearchEvidence } from "./research-model";
import { RESEARCH_POST_MIN_SCORE } from "./research-policy";

export type EvidenceCacheInput = { id: string; content?: string; [key: string]: unknown };
type CitationRepair = { itemId: string; familyKey: string; original: string; selected: string; method: "ordered_omission_to_contiguous_span" };
export type EvidenceCacheValue = { findings: ResearchEvidence[]; citationRepairs?: CitationRepair[] };
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

function citationText(value: string) {
  const typography: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"' };
  const chars: string[] = [], positions: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (/\s/.test(char)) {
      if (chars.length && chars.at(-1) !== " " && chars.at(-1) !== "(") { chars.push(" "); positions.push(index); }
    } else {
      if (/[,;:!?)]/.test(char) && chars.at(-1) === " ") { chars.pop(); positions.pop(); }
      const lower = (typography[char] || char).toLowerCase();
      for (let unit = 0; unit < lower.length; unit++) { chars.push(lower[unit]); positions.push(index); }
    }
  }
  if (chars.at(-1) === " ") { chars.pop(); positions.pop(); }
  return { text: chars.join(""), positions };
}

export function canonicalResearchCitation(content: string, evidence: string): string | null {
  const exact = matchResearchQuote(content, evidence);
  if (exact) return exact.length <= 600 ? evidence : null;
  const closingMarks: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
  let quote = evidence.trim();
  if (closingMarks[quote[0]] === quote.at(-1)) quote = quote.slice(1, -1).trim();
  const fragments = quote.split(/\.{3}|…/).map(fragment => fragment.trim()).filter(Boolean);
  if (fragments.length < 2) return null;
  const source = citationText(content), spans: string[] = [];
  const word = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));
  let cursor = 0;
  for (const fragment of fragments) {
    const needle = citationText(fragment).text;
    if (!needle) return null;
    let start = source.text.indexOf(needle, cursor);
    while (start >= 0 && (word(needle[0]) && word(source.text[start - 1])
      || word(needle.at(-1)) && word(source.text[start + needle.length]))) start = source.text.indexOf(needle, start + 1);
    if (start < 0) return null;
    spans.push(content.slice(source.positions[start], source.positions[start + needle.length - 1] + 1));
    cursor = start + needle.length;
  }
  return spans.filter(span => span.length >= 20 && span.length <= 600)
    .reduce<string | null>((longest, span) => !longest || span.length > longest.length ? span : longest, null);
}

export function validateResearchEvidenceCacheValue(value: unknown, items: EvidenceCacheInput[], enabledProfileIds: string[]): EvidenceCacheValue {
  const output = researchEvidenceSchema.parse(value);
  const findings = validateResearchEvidenceCoverage(output.findings, items.map(item => item.id));
  validateResearchEvidenceProfiles(findings, enabledProfileIds);
  const bodies = new Map(items.map(item => [item.id, item.content]));
  const repairs: CitationRepair[] = [];
  for (const primary of findings) {
    for (const idea of [primary, ...(primary.additionalIdeas || [])]) {
      if (idea.score < RESEARCH_POST_MIN_SCORE) continue;
      const selected = canonicalResearchCitation(bodies.get(primary.itemId) || "", idea.evidence);
      if (!selected) throw new Error(`Research evidence has an unsupported passing quote for source ${primary.itemId}`);
      if (selected !== idea.evidence) {
        repairs.push({ itemId: primary.itemId, familyKey: idea.familyKey, original: idea.evidence, selected, method: "ordered_omission_to_contiguous_span" });
        idea.evidence = selected;
      }
    }
  }
  if (value && typeof value === "object" && "citationRepairs" in value && Array.isArray(value.citationRepairs)) {
    for (const repair of value.citationRepairs) {
      if (!repair || repair.method !== "ordered_omission_to_contiguous_span" || typeof repair.original !== "string"
        || repair.original.length > 600 || typeof repair.selected !== "string") continue;
      const primary = findings.find(finding => finding.itemId === repair.itemId);
      const idea = primary && [primary, ...(primary.additionalIdeas || [])].find(idea => idea.familyKey === repair.familyKey && idea.evidence === repair.selected);
      if (idea && primary && canonicalResearchCitation(bodies.get(primary.itemId) || "", repair.original) === repair.selected
        && !repairs.some(saved => saved.itemId === repair.itemId && saved.familyKey === repair.familyKey))
        repairs.push({ itemId: primary.itemId, familyKey: idea.familyKey, original: repair.original, selected: repair.selected, method: "ordered_omission_to_contiguous_span" });
    }
  }
  return repairs.length ? { ...output, citationRepairs: repairs } : output;
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
  const metadata = "citationRepairs" in value ? { citationRepairs: value.citationRepairs } : {};
  if (Array.isArray(findings)) return findings.flatMap(finding =>
    finding && typeof finding === "object" && typeof finding.itemId === "string"
      ? [{ itemId: finding.itemId as string, value: { findings: [finding], ...metadata } }] : []);
  if (findings && typeof findings === "object") return Object.entries(findings).map(([itemId, finding]) => ({
    itemId, value: { findings: { [itemId]: finding }, ...metadata },
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
