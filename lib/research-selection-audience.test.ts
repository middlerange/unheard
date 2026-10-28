import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ResearchAudience } from './research-audience';
import { researchSelectionAudience, RESEARCH_SELECTION_VIEW_VERSION } from './research-selection-audience';

const format = 'Writing and evidence: Develop one original insight. Open with a specific observation or defensible tension, explain the mechanism with a concrete example, and end with a useful implication or action. Use plain English, calm curiosity, varied sentence lengths, and paragraphs of 1-3 sentences. Avoid theatrical one-line formatting, corporate filler, hype, copied expressions, canned contrast formulas, hashtags, emojis, engagement bait, and routine sales pitches.';
const evidence = 'Attribute the publisher’s claims. If the evidence cannot support a useful post, skip it. Never treat an opinion as a measured result.';
const approval = 'These are drafts for review; publishing requires explicit approval of the latest version in Slack.';
function sections(group: 'company' | 'personal') {
  return [
    `Identity and purpose: Select ${group === 'company' ? 'direct adoption lessons' : 'practical product, growth and distribution decisions'}. Use a warm voice. Prefer a short post.`,
    'Audience and selection: Prefer a specific mechanism or reasoned argument; exclude unsupported hype.',
    `${format} ${evidence} ${approval}`,
    `Discovery breadth: ${group === 'company' ? 'Preserve direct product-adoption relevance.' : 'A distribution decision does not need to concern onboarding.'}`,
    'Product-team decisions: Preserve population and geography. Skip salary sensationalism.',
    `Distribution identity: This profile belongs to the ${group} account identity. Each story must choose exactly one configured account identity and provide versions for all of its enabled, supported publishing channels. A single draft or approval must never mix company and personal identities or other account groups. Choose the identity whose purpose best fits the source, then adapt its one post for the platforms in that group.`,
  ];
}
function audience(): ResearchAudience {
  return {
    generalAudience: 'Product and growth practitioners; preserve the captured scope.',
    publishingProfiles: ['company', 'company', 'personal', 'personal'].map((group, index) => ({
      id: `profile-${index}`, name: `Name ${index}`, platform: index % 2 ? 'twitter' : 'linkedin', groupName: group,
      systemPrompt: sections(group as 'company' | 'personal').join(index % 2 ? '\\n\\n' : '\n\n'), enabled: true, kind: 'publishing_profile',
    })),
  };
}

describe('research selection audience projection', () => {
  it('retains every identity in order and verbatim selection/evidence scope without duplicating full prompts', () => {
    const captured = audience(), view = researchSelectionAudience(captured);
    expect(view.selectionViewVersion).toBe(RESEARCH_SELECTION_VIEW_VERSION);
    expect(view.generalAudience).toBe(captured.generalAudience);
    expect(view.publishingProfiles).toHaveLength(4);
    for (const [index, profile] of view.publishingProfiles.entries()) {
      const { systemPrompt, ...identity } = captured.publishingProfiles[index];
      expect(profile).toMatchObject(identity);
      expect(profile).not.toHaveProperty('systemPrompt');
      expect(profile.selectionProjection).toBe('relevance_sections');
      for (const section of sections(profile.groupName as 'company' | 'personal').slice(0, -1).filter(section => !section.startsWith('Writing and evidence:')))
        expect(profile.selectionInstructions).toContain(section);
      expect(profile.selectionInstructions).toContain(evidence);
      expect(profile.selectionInstructions).not.toContain(format);
      expect(profile.selectionInstructions).not.toContain(approval);
      expect(profile.selectionInstructions).not.toContain('provide versions for all');
      expect(profile.selectionInstructions.length).toBeLessThan(systemPrompt.length);
    }
  });

  it('leaves the full captured audience and its hash unchanged', () => {
    const captured = audience(), serialized = JSON.stringify(captured);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    for (const profile of captured.publishingProfiles) Object.freeze(profile);
    Object.freeze(captured.publishingProfiles); Object.freeze(captured);
    researchSelectionAudience(captured);
    expect(JSON.stringify(captured)).toBe(serialized);
    expect(hash(JSON.stringify(captured))).toBe(hash(serialized));
  });

  it.each([
    (prompt: string) => `Custom audience: Preserve every user constraint.\n${prompt}`,
    (prompt: string) => prompt.replace(format, 'Writing and evidence: Only cover European regulated markets. Use a short post.'),
    (prompt: string) => `${prompt}\n\nAdditional exclusions: Never discuss consumer apps.`,
    (prompt: string) => prompt.replace('Each story must choose', 'Exclude gambling content. Each story must choose'),
    (prompt: string) => prompt.replace('Audience and selection:', 'Discovery breadth:'),
    (_prompt: string) => '  Custom unstructured prompt.\nKeep literal spacing and every restriction.  ',
  ])('falls back to the exact full prompt for unfamiliar or ambiguous structures: %s', alter => {
    const captured = audience();
    captured.publishingProfiles[0].systemPrompt = alter(captured.publishingProfiles[0].systemPrompt);
    const profile = researchSelectionAudience(captured).publishingProfiles[0];
    expect(profile.selectionProjection).toBe('full_prompt');
    expect(profile.selectionInstructions).toBe(captured.publishingProfiles[0].systemPrompt);
  });

  it('preserves new custom evidence constraints inside the retained evidence span', () => {
    const captured = audience();
    captured.publishingProfiles[0].systemPrompt = captured.publishingProfiles[0].systemPrompt.replace(evidence, `${evidence} Exclude individual compensation claims.`);
    expect(researchSelectionAudience(captured).publishingProfiles[0].selectionInstructions).toContain(`${evidence} Exclude individual compensation claims.`);
  });
});
