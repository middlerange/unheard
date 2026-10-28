import { parseResearchAudience } from '../lib/research-audience';
import { evidenceJsonSchema, evidenceJsonSchemaForItems, researchEvidenceSchema, validateResearchEvidenceCoverage, validateResearchEvidenceProfiles } from '../lib/research-model';
import { hasUsablePewResearchBody } from '../lib/research-pew';

export type RecallVariant = 'baseline' | 'current';

export function assertRecallModelCallAllowed(allowModelCalls: boolean, maxNewCalls: number, newCalls: number) {
  if (!Number.isInteger(maxNewCalls) || maxNewCalls < 0) throw new Error('New-call budget must be a nonnegative integer');
  if (!allowModelCalls) throw new Error('Cache-only evaluation: an uncached qualification request needs --allow-model-calls and an explicit --max-new-calls budget');
  if (newCalls >= maxNewCalls) throw new Error('Qualification request budget reached; inspect saved results before increasing --max-new-calls');
}

export function recallEvaluationContext(variant: RecallVariant, context: { icp?: unknown }) {
  if (typeof context.icp !== 'string' || !context.icp) throw new Error('Context requires icp');
  const audience = variant === 'current' ? parseResearchAudience(context.icp) : null;
  return {
    payload: audience ?? { icp: context.icp },
    profileIds: audience?.publishingProfiles.map(profile => profile.id) ?? [],
  };
}

export function recallEvidenceRoute(variant: RecallVariant, item: { sourceId: string; content: string; title: string }) {
  return variant === 'current' && item.content.trim().length >= 500
    && (item.sourceId !== 'pew-ai-original-research' || hasUsablePewResearchBody(item.content, item.title))
    ? 'direct_evidence' : 'metadata_screen';
}

export function recallEvidenceSchema(variant: RecallVariant, ids: string[], profileIds: string[]) {
  return variant === 'baseline'
    ? { ...evidenceJsonSchema, properties: { findings: { ...evidenceJsonSchema.properties.findings, minItems: ids.length, maxItems: ids.length } } }
    : evidenceJsonSchemaForItems(ids, profileIds);
}

export function parseRecallEvidence(variant: RecallVariant, value: unknown, ids: string[], profileIds: string[]) {
  const parsed = researchEvidenceSchema.parse(value);
  if (variant === 'current') {
    validateResearchEvidenceCoverage(parsed.findings, ids);
    validateResearchEvidenceProfiles(parsed.findings, profileIds);
  }
  return parsed;
}

export function assertRecallReplayCompatible(expected: unknown, saved: unknown | null, entries: string[]) {
  if (saved === null ? entries.length > 0 : JSON.stringify(saved) !== JSON.stringify(expected))
    throw new Error('Current replay output is incompatible with its audience, prompts, schema or routing contract; use a new --out directory. Historical outputs were preserved.');
}
