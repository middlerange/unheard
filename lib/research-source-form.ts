import { RESEARCH_EVIDENCE_OUTPUT_TOKENS } from './research-model';
import {
  normalizeResearchSourceReview, RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS, researchSourceReviewSchemaForItems,
} from './research-source-review-model';
import type { ResearchSourceReviewPolicy } from './research-source-review';

export const RESEARCH_SOURCE_FORM_VERSION = 'research-source-form-v1';
export const RESEARCH_SOURCE_FORM_FORMAT = 'research_intake_form';
export const RESEARCH_SOURCE_FORM_MODEL = 'claude-sonnet-5-5';
export const RESEARCH_SOURCE_FORM_INSTRUCTIONS = `${RESEARCH_SOURCE_REVIEW_CONSISTENCY_INSTRUCTIONS}

This review inspects a captured public research intake form. A substantive request for a before/after account, an evidence artifact such as screenshots or a demonstration, and an actual review or follow-up sequence may support an attributed described method or a checkable research-participation opportunity. Read the captured requirements and handoffs, including any publication review, together as one coherent core. A participant can assess what to contribute and what happens next without completed research findings. A bounded method teardown can describe how the publisher solicits evidence, but must not claim that this procedure validates it.

Separate the source's observable intake from the analyst's interpretation. summary attributes only the contribution requested, evidence requested and stated next steps. contentAngle identifies the actual supported participation decision, useful distinction or explicitly labeled proposed inspection. whyItMatters connects it to a specific configured reader job. Do not invent an implementation, evaluation criterion or product-team application to make the form useful. Preserve the distinction between broad personal remits and narrower company remits, including any exclusions in each profile. An explicit format label supplies neither evidence nor topical fit.

Announced original research is not completed original research. Intended impact, repeatability or learning is an aim, not a finding. A before/after account or demonstration alone does not establish causal impact, effectiveness, independent validation or representative results. Do not invent selection rules, measurements, participant outcomes, publication dates or an active participation window. Preserve stated access, partial-demonstration and publication-review limits without expanding them into unstated guarantees.

A form title, audience label, community agenda, welcome message, subscription invitation or pure offer alone remains insufficient. Concrete logistics do not automatically supply a substantive research core. Require a supported bounded claim, a useful reader decision or distinction and actual profile fit under the unchanged categorical rubric. Reject missing or unsupported cores with a precise reason; do not infer unseen form questions, linked demonstrations or eventual findings.

Submit the source-keyed findings object exactly once through submit_research, including additionalIdeas for every source. Use only own-source selectable passage IDs for evidence. The tool only returns research data; it performs no external action.`;

function validateOutputTokens(outputTokens: number) {
  if (!Number.isInteger(outputTokens) || outputTokens <= 0 || outputTokens > 128_000)
    throw new Error('Form review requires a valid output budget');
}

export function researchSourceFormContract(outputTokens = RESEARCH_EVIDENCE_OUTPUT_TOKENS) {
  validateOutputTokens(outputTokens);
  return { version: RESEARCH_SOURCE_FORM_VERSION, format: RESEARCH_SOURCE_FORM_FORMAT,
    instructions: RESEARCH_SOURCE_FORM_INSTRUCTIONS, model: RESEARCH_SOURCE_FORM_MODEL,
    schema: researchSourceReviewSchemaForItems(['item'], ['profile']), outputTokens };
}

export function researchSourceFormPolicy(outputTokens = RESEARCH_EVIDENCE_OUTPUT_TOKENS): ResearchSourceReviewPolicy {
  validateOutputTokens(outputTokens);
  return { version: RESEARCH_SOURCE_FORM_VERSION, model: RESEARCH_SOURCE_FORM_MODEL,
    instructions: RESEARCH_SOURCE_FORM_INSTRUCTIONS,
    sourceSchema: (source, profileIds) => researchSourceReviewSchemaForItems([source.id], profileIds),
    requestMetadata: () => ({ artifact: { version: RESEARCH_SOURCE_FORM_VERSION, format: RESEARCH_SOURCE_FORM_FORMAT },
      reviewTransport: 'anthropic-tool-v1', reviewOutputTokens: outputTokens }),
    normalize: normalizeResearchSourceReview,
  };
}
