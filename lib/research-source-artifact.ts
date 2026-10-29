import { RESEARCH_EVIDENCE_OUTPUT_TOKENS } from './research-model';
import { RESEARCH_SOURCE_DEPTH_INSTRUCTIONS, researchSourceDepthRequestMetadata, researchSourceDepthSchema, normalizeResearchSourceDepth } from './research-source-depth-model';
import type { ResearchSourceReviewPolicy } from './research-source-review';
import type { ResearchArtifactFormat, ResearchArtifactSourceFormats } from './research-types';
import { RESEARCH_SOURCE_FORM_FORMAT, researchSourceFormContract, researchSourceFormPolicy } from './research-source-form';

export const RESEARCH_SOURCE_ARTIFACT_VERSION = 'research-source-artifact-v1';
export const RESEARCH_SOURCE_ARTIFACT_FORMAT = 'inspectable_public_artifact';
export const RESEARCH_SOURCE_ARTIFACT_MODEL = 'claude-sonnet-5-5';
export const RESEARCH_SOURCE_ARTIFACT_INSTRUCTIONS = `${RESEARCH_SOURCE_DEPTH_INSTRUCTIONS}

This final review inspects a captured public artifact. Observable design choices, named alternatives, access or usage boundaries, interaction behavior and handoffs can support a bounded product or growth observation even when the publisher has not written the analyst's lesson. Commercial ownership and page format supply neither rejection nor relevance credit. Assess the actual captured detail and each profile's reader job.

Separate observation from analysis. The summary attributes only visible behavior, options, limits or a taxonomy to the publisher. contentAngle states the analyst's useful distinction, explicitly labeled inference or proposed inspection/test where it goes beyond the description. whyItMatters connects that bounded distinction to a concrete configured reader decision. Do not invent hidden selection criteria, missing plan details, user behavior, adoption, conversion effects or successful results. A free-start button does not establish an ongoing free plan; absent prices, periods and availability stay unknown. An explicit list of approaches may support an attributed taxonomy without establishing an unseen rule for selecting among them.

Evaluate an artifact at the evidence standard of its final claim. Its literal page can support a description of its own access boundary or options, without independent effectiveness data. It cannot establish that the choice improves a business outcome. Keep all material names, conditions and contrasts needed for a useful complete core, and cite every necessary passage separately. Do not replace the artifact with generic advice or repeat its benefit promises as facts.

A title naming the audience, an event invitation's schedule or list of activities, a welcome message, or an offer to teach something does not by itself provide a substantive reader-job decision. Do not manufacture topical fit through a loose analogy. If a source contains no useful supported option, behavior, distinction, method or capability for any configured profile, reject it with the unchanged categorical rubric and a precise reason. This routing flag is not an instruction to accept, raise scores or fill a quota.

Submit the assessment exactly once through submit_research, including wholeSource and every required group. The tool only returns research data; it performs no external action.`;

export function researchSourceArtifactContract(outputTokens = RESEARCH_EVIDENCE_OUTPUT_TOKENS, format: ResearchArtifactFormat = RESEARCH_SOURCE_ARTIFACT_FORMAT) {
  if (format === RESEARCH_SOURCE_FORM_FORMAT) return researchSourceFormContract(outputTokens);
  if (format !== RESEARCH_SOURCE_ARTIFACT_FORMAT) throw new Error('Unknown artifact review format');
  return { version: RESEARCH_SOURCE_ARTIFACT_VERSION, format: RESEARCH_SOURCE_ARTIFACT_FORMAT,
    instructions: RESEARCH_SOURCE_ARTIFACT_INSTRUCTIONS, model: RESEARCH_SOURCE_ARTIFACT_MODEL,
    schema: researchSourceDepthSchema({ id: 'item', content: '' }, ['profile']), outputTokens };
}

export function researchSourceArtifactPolicy(outputTokens = RESEARCH_EVIDENCE_OUTPUT_TOKENS, format: ResearchArtifactFormat = RESEARCH_SOURCE_ARTIFACT_FORMAT): ResearchSourceReviewPolicy {
  if (format === RESEARCH_SOURCE_FORM_FORMAT) return researchSourceFormPolicy(outputTokens);
  if (format !== RESEARCH_SOURCE_ARTIFACT_FORMAT) throw new Error('Unknown artifact review format');
  if (!Number.isInteger(outputTokens) || outputTokens <= 0 || outputTokens > 128_000) throw new Error('Artifact review requires a valid output budget');
  return { version: RESEARCH_SOURCE_ARTIFACT_VERSION, model: RESEARCH_SOURCE_ARTIFACT_MODEL,
    instructions: RESEARCH_SOURCE_ARTIFACT_INSTRUCTIONS, sourceSchema: researchSourceDepthSchema,
    requestMetadata: async source => {
      const { groups, depth } = await researchSourceDepthRequestMetadata(source);
      return { groups, depth, artifact: { version: RESEARCH_SOURCE_ARTIFACT_VERSION, format: RESEARCH_SOURCE_ARTIFACT_FORMAT },
        reviewTransport: 'anthropic-tool-v1', reviewOutputTokens: outputTokens };
    },
    normalize: normalizeResearchSourceDepth,
  };
}

export function validResearchArtifactSourceFormats(value: unknown, sourceIds: readonly string[] | undefined): value is ResearchArtifactSourceFormats {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !sourceIds) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([id, format]) => sourceIds.includes(id) && format === RESEARCH_SOURCE_FORM_FORMAT);
}

export function researchSourceArtifactRoutingContract(outputTokens = RESEARCH_EVIDENCE_OUTPUT_TOKENS, artifactSourceFormats?: ResearchArtifactSourceFormats) {
  const artifact = researchSourceArtifactContract(outputTokens);
  return artifactSourceFormats ? { artifact, artifactSourceFormats,
    form: researchSourceArtifactContract(outputTokens, RESEARCH_SOURCE_FORM_FORMAT) } : artifact;
}
