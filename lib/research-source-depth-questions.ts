import {
  RESEARCH_SOURCE_DEPTH_INSTRUCTIONS, RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS,
  researchSourceDepthRequestMetadata, researchSourceDepthSchema, normalizeResearchSourceDepth,
  type ResearchSourceDepthOptions, type ResearchSourceDepthSource, type ResearchSourceDepthGroup,
} from './research-source-depth-model';
import type { ResearchSourceReviewPolicy } from './research-source-review';
import { researchAttributedQuoteRanges, RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION } from './research-source-depth-quotes';

export const RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION = 'research-source-depth-questions-v1';
export const RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION = 'attributed-quotes-and-questions-v2';
export const RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT = { reviewTimeoutMs: 240_000, reviewClaimLeaseMs: 270_000 } as const;
export function researchSourceDepthGroupingRoute(content: string, grouping: string): 'quotes' | 'questions' | null {
  if (grouping !== RESEARCH_SOURCE_DEPTH_QUOTES_GROUPING_VERSION && grouping !== RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION) throw new Error('Unknown source depth grouping policy');
  if (researchAttributedQuoteRanges(content).length) return 'quotes';
  return grouping === RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION && researchQuestionRanges(content).length ? 'questions' : null;
}
const instructions = `

Some required groups have kind question_section: a literal standalone publisher question under an explicit FAQ heading and the captured text following it, ending at the next standalone question or the end of the captured source. Inspect EACH answer independently, including late answers. Select its actual supported distinction, documented capability, limitation or decision when useful; do not substitute the page's introductory theme. The question title is not answer evidence. The first citation of a passing group claim must overlap that group's answer body; other passages in this SAME source may provide explicit context. These literal ranges do not establish that adjacent paragraphs are an answer or that the publisher supports an inferred connection. Preserve those boundaries in the selected brief. Every question group must be assessed, and any or all may reject. An empty captured answer has no focal support and must reject. Required presence is coverage, not an acceptance quota. Keep all unchanged categorical, profile, scope and own-source proof rules.`;
export const RESEARCH_SOURCE_DEPTH_QUESTIONS_INSTRUCTIONS = RESEARCH_SOURCE_DEPTH_INSTRUCTIONS + instructions;
export const RESEARCH_SOURCE_DEPTH_QUESTIONS_SONNET_INSTRUCTIONS = RESEARCH_SOURCE_DEPTH_SONNET_INSTRUCTIONS + instructions;

export function researchQuestionRanges(content: string): Array<Omit<ResearchSourceDepthGroup, 'selectablePassageIds'>> {
  const questions: Array<{ start: number; bodyStart: number; title: string }> = [];
  let faqRegion = false;
  // Require an explicit publisher FAQ heading and paragraph questions, not rhetorical prose.
  const paragraph = /(?:^|\r?\n[\t ]*\r?\n)([^\r\n]+)(?=\r?\n[\t ]*\r?\n|$)/g;
  for (const match of content.matchAll(paragraph)) {
    const title = match[1].trim();
    if (/^(?:#{1,6}\s*)?(?:frequently asked questions|faqs?|q\s*&\s*a|questions and answers)\s*:?$/i.test(title)) { faqRegion = true; continue; }
    if (!faqRegion) continue;
    if (title.length < 12 || title.length > 300 || !title.endsWith('?') || /^["'‘“]/.test(title)) continue;
    const start = match.index + match[0].length - match[1].length + match[1].indexOf(title);
    let bodyStart = start + title.length;
    while (bodyStart < content.length && /\s/.test(content[bodyStart])) bodyStart++;
    questions.push({ start, bodyStart, title });
  }
  return questions.map((question, index) => {
    const end = questions[index + 1]?.start ?? content.length;
    return { ...question, end, id: `question-${question.start}-${end}`, kind: 'question_section' as const };
  });
}

const options: ResearchSourceDepthOptions = {
  version: RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION,
  groupingVersion: RESEARCH_SOURCE_DEPTH_QUESTIONS_GROUPING_VERSION,
  groupBuilder: (source, passages, baseline) => ({ ...baseline, ...Object.fromEntries(researchQuestionRanges(source.content).map(group => [group.id, {
    ...group, selectablePassageIds: passages.filter(passage => passage.selectable && passage.start < group.end && passage.end > group.bodyStart
      && source.content.slice(Math.max(passage.start, group.bodyStart), Math.min(passage.end, group.end)).trim().length >= 20).map(passage => passage.passageId),
  }])) }),
};
export const researchSourceQuestionDepthSchema = (source: ResearchSourceDepthSource, profiles: string[]) => researchSourceDepthSchema(source, profiles, options);
export const researchSourceQuestionDepthRequestMetadata = (source: ResearchSourceDepthSource) => researchSourceDepthRequestMetadata(source, options);
export const normalizeResearchSourceQuestionDepth: typeof normalizeResearchSourceDepth = (raw, sources, profiles) => normalizeResearchSourceDepth(raw, sources, profiles, options);
export const researchSourceDepthQuestionPolicy: ResearchSourceReviewPolicy = {
  version: RESEARCH_SOURCE_DEPTH_QUESTIONS_VERSION, instructions: RESEARCH_SOURCE_DEPTH_QUESTIONS_INSTRUCTIONS,
  sourceSchema: researchSourceQuestionDepthSchema,
  requestMetadata: async source => { const { groups, depth } = await researchSourceQuestionDepthRequestMetadata(source); return { groups, depth, ...RESEARCH_SOURCE_DEPTH_QUESTIONS_TRANSPORT }; },
  normalize: normalizeResearchSourceQuestionDepth,
};
