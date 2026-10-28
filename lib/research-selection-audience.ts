import type { ResearchAudience } from './research-audience';

export const RESEARCH_SELECTION_VIEW_VERSION = 'research-selection-v1';
const markers = ['Identity and purpose:', 'Audience and selection:', 'Writing and evidence:', 'Discovery breadth:', 'Product-team decisions:', 'Distribution identity:'];
const writingPrefix = [
  'Writing and evidence: Develop one original insight.',
  'Open with a specific observation or defensible tension, explain the mechanism with a concrete example, and end with a useful implication or action.',
  'Use plain English, calm curiosity, varied sentence lengths, and paragraphs of 1-3 sentences.',
  'Avoid theatrical one-line formatting, corporate filler, hype, copied expressions, canned contrast formulas, hashtags, emojis, engagement bait, and routine sales pitches.',
].join(' ') + ' ';
const approvalSuffix = ' These are drafts for review; publishing requires explicit approval of the latest version in Slack.';
const distribution = 'Each story must choose exactly one configured account identity and provide versions for all of its enabled, supported publishing channels. A single draft or approval must never mix company and personal identities or other account groups. Choose the identity whose purpose best fits the source, then adapt its one post for the platforms in that group.';

function relevanceSections(profile: ResearchAudience['publishingProfiles'][number]) {
  const sections = profile.systemPrompt.split(/\r?\n[ \t]*\r?\n|\\n\\n/);
  const seen = new Set<number>(), excerpts: string[] = [];
  let previous = -1;
  for (const section of sections) {
    const index = markers.findIndex(marker => section.startsWith(`${marker} `));
    if (index < 0 || index <= previous) return null;
    previous = index;
    seen.add(index);
    if (index === 2) {
      if (!section.startsWith(writingPrefix) || !section.endsWith(approvalSuffix)) return null;
      const evidence = section.slice(writingPrefix.length, -approvalSuffix.length);
      if (!evidence.trim()) return null;
      excerpts.push(evidence);
    } else if (index === 5) {
      if (!['company', 'personal'].includes(profile.groupName || '')
        || section !== `Distribution identity: This profile belongs to the ${profile.groupName} account identity. ${distribution}`) return null;
    } else excerpts.push(section);
  }
  return [0, 1, 2, 3, 5].every(index => seen.has(index)) ? excerpts.join('\n\n') : null;
}

export function researchSelectionAudience(audience: ResearchAudience) {
  return {
    selectionViewVersion: RESEARCH_SELECTION_VIEW_VERSION,
    generalAudience: audience.generalAudience,
    publishingProfiles: audience.publishingProfiles.map(profile => {
      const { systemPrompt, ...identity } = profile;
      const selected = relevanceSections(profile);
      return { ...identity, selectionInstructions: selected ?? systemPrompt,
        selectionProjection: selected === null ? 'full_prompt' as const : 'relevance_sections' as const };
    }),
  };
}
