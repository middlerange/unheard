import { describe, expect, it } from 'vitest';
import { researchNoveltyContext, type ResearchPriorDraft } from './research-novelty';

const profiles = [
  { id: 'personal-li', platform: 'linkedin', groupName: 'Personal' },
  { id: 'company-li', platform: 'linkedin', groupName: 'Company' },
];
const current = {
  findingId: 'current-finding', familyKey: 'prototype-handoff-checkpoint',
  title: 'Reddit AI prototyping harness', url: 'https://source-two.example/reddit-proto',
  summary: 'Realistic signed-in data and reviewed PRDs connect a prototype to engineering readiness.',
  contentAngle: 'Review the specification before engineering ships the prototype.',
  evidence: 'Use realistic signed-in data and review the PRD before engineering handoff.',
  content: 'Reddit Proto uses realistic signed-in data, reviewed PRDs and engineering checkpoints. Lock navigation during a hypothesis test and open exploration during feedback. An annotation includes an element, code location and intent.',
};
function history(id: string, options: Partial<ResearchPriorDraft> = {}, channelId = 'personal-li'): ResearchPriorDraft {
  return {
    id, runId: 'earlier-run', findingId: `${id}-finding`, createdAt: 1000, status: 'draft', isTest: false,
    familyKey: 'reddit-ai-prototyping-real-data', title: 'Reddit Proto engineering readiness',
    url: `https://original.example/${id}`, publishedAt: 100,
    summary: 'A realistic prototype needs reviewed implementation context.', contentAngle: 'Review the PRD at engineering handoff.',
    evidence: 'Use realistic signed-in data and review the PRD before engineering handoff.',
    content: JSON.stringify({ targets: [{ channelId, content: 'Inspect realistic signed-in data, then review the PRD before treating the prototype as engineering ready.', thread: [] }], editorial: { sourceFact: 'Reddit Proto combines real data with reviewed PRDs.', alpha: 'Prototype fidelity does not replace an implementation checkpoint.', readerDecision: 'Require a reviewed PRD before engineering handoff.' } }),
    ...options,
  };
}

describe('prior-post novelty context', () => {
  it('retrieves cross-source event aliases without deciding that every angle is a duplicate', () => {
    const context = researchNoveltyContext([history('proto')], profiles, current, profiles);
    expect(context.priorPosts[0]).toMatchObject({ familyKey: 'reddit-ai-prototyping-real-data', identityGroupIds: ['group:personal'], readerDecision: 'Require a reviewed PRD before engineering handoff.' });
    expect(context.priorPosts[0].sourceUrl).not.toBe(current.url);
    expect(context.priorPostRetrieval).toMatchObject({ scannedCount: 1, matchingCount: 1, includedCount: 1 });
  });

  it('inspects all history and reserves eight relevant comparisons for each enabled identity', () => {
    const drafts = Array.from({ length: 24 }, (_, index) => history(`personal-${index}`));
    drafts.push(history('company-last', {}, 'company-li'));
    const context = researchNoveltyContext(drafts, profiles, current, profiles);
    expect(context.priorPosts).toHaveLength(9);
    expect(context.priorPosts.some(post => post.draftId === 'company-last')).toBe(true);
    expect(context.priorPostRetrieval).toMatchObject({ scannedCount: 25, matchingCount: 25, includedCount: 9, contextLimitPerIdentity: 8, identities: [
      { identityGroupId: 'group:personal', matchingCount: 24, includedCount: 8 },
      { identityGroupId: 'group:company', matchingCount: 1, includedCount: 1 },
    ] });
  });

  it('retains legacy copy endings and rejected status without inventing ledger decisions or publication', () => {
    const ending = 'Review the PRD and engineering-readiness checkpoints before handing off the realistic signed-in prototype.';
    const draft = history('legacy', { status: 'rejected', content: JSON.stringify({ targets: [{ channelId: 'personal-li', content: `A prototype account. ${'Background detail. '.repeat(200)} ${ending}` }] }) });
    const context = researchNoveltyContext([draft], profiles, current, profiles);
    expect(context.priorPosts[0]).toMatchObject({ legacyWithoutEditorial: true, readerDecision: null, alpha: null, status: 'rejected' });
    expect(context.priorPosts[0].copyExcerpt).toContain(ending);
    expect(context.priorPosts[0].copyExcerpt.length).toBeLessThan(1850);
  });

  it('includes current-run history, excludes the finding being edited and explicitly marked test artifacts', () => {
    const drafts = [history('saved-this-run', { runId: 'current-run' }), history('self', { findingId: current.findingId }), history('test-artifact', { isTest: true })];
    const context = researchNoveltyContext(drafts, profiles, current, profiles);
    expect(context.priorPosts.map(post => post.draftId)).toEqual(['saved-this-run']);
    expect(context.priorPostRetrieval).toMatchObject({ scannedCount: 3, eligibleCount: 1 });
  });

  it('does not feed unrelated history or another identity into a single-account comparison', () => {
    const unrelated = history('astronomy', { familyKey: 'planetary-orbit', title: 'Distant planetary orbit', summary: 'Telescope measurements', contentAngle: 'Observe planetary spectra', evidence: 'Spectral evidence concerns the outer planet.', content: JSON.stringify({ targets: [{ channelId: 'personal-li', content: 'Astronomical spectra constrain planetary orbits.' }] }) });
    const context = researchNoveltyContext([unrelated, history('company', {}, 'company-li')], profiles, current, profiles.slice(0, 1));
    expect(context.priorPosts).toEqual([]);
    expect(context.priorPostRetrieval).toMatchObject({ scannedCount: 2, eligibleCount: 1, matchingCount: 0 });
  });

  it('keeps source identity query parameters when comparing distinct videos or parameterized articles', () => {
    const draft = history('other-video', { url: 'https://video.example/watch?v=other', familyKey: 'planetary-orbit', title: 'Distant planetary orbit', summary: 'Astronomy', contentAngle: 'Observe spectra', evidence: 'Telescope observations.', content: JSON.stringify({ targets: [{ channelId: 'personal-li', content: 'Planetary spectra.' }] }) });
    const context = researchNoveltyContext([draft], profiles, { ...current, url: 'https://video.example/watch?v=current' }, profiles);
    expect(context.priorPosts).toEqual([]);
  });
  it('keeps legacy mixed-account copy separated by actual target identity', () => {
    const draft = history('mixed', { content: JSON.stringify({ targets: [
      { channelId: 'personal-li', content: 'Test one prototype navigation flow for a hypothesis; open exploration for feedback.' },
      { channelId: 'company-li', content: 'Use realistic signed-in data and review the PRD before the engineering-readiness checkpoint.' },
    ], editorial: { readerDecision: 'This old mixed ledger cannot establish which account owns the decision.' } }) });
    const context = researchNoveltyContext([draft], profiles, current, profiles);
    expect(context.priorPosts).toHaveLength(2);
    const personal = context.priorPosts.find(post => post.identityGroupIds.includes('group:personal'))!;
    const company = context.priorPosts.find(post => post.identityGroupIds.includes('group:company'))!;
    expect(personal.copyExcerpt).toContain('navigation');
    expect(personal.copyExcerpt).not.toContain('engineering-readiness checkpoint');
    expect(company.copyExcerpt).toContain('engineering-readiness checkpoint');
    expect(company.copyExcerpt).not.toContain('navigation');
    expect(personal.draftId).toBe(company.draftId);
    expect(context.priorPostRetrieval.identities).toEqual([
      { identityGroupId: 'group:personal', matchingCount: 1, includedCount: 1 },
      { identityGroupId: 'group:company', matchingCount: 1, includedCount: 1 },
    ]);
    expect(personal.readerDecision).toBeNull();
    expect(company.readerDecision).toBeNull();
  });
});
