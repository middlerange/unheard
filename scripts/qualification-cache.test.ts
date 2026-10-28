import { describe, expect, it, vi } from 'vitest';
import { evaluateQualificationCache } from './qualification-cache';

const source = (id: string, score = 80, grounded = true) => ({ id, score, grounded, assessment: { chosenProfileId: 'personal', profileFit: 'A decision in the supplied remit.', familyKey: 'decision' } });
const row = (id: string, sourceId?: string) => ({ winnerId: id, population: 'baseline', exactOriginUrl: sourceId ? 'https://example.org/' + sourceId : null, exactCandidateMatches: sourceId ? [{ itemId: sourceId }] : [], exactExclusions: [] });
describe('zero-network cached qualification diagnostics', () => {
  it('keeps every missing-source row and separates one source from several different ideas', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Network is forbidden'); });
    try {
      const result = evaluateQualificationCache({ status: 'completed', runId: 'run', model: 'saved', prompt_version: 'saved-v15', candidates: [source('article')] }, { completedReplay: true, replaySha256: 'hash', rows: [row('clear', 'article'), row('different', 'article'), row('missing')] }, { rows: [{ winnerId: 'clear', manualOutcome: 'clear_central_summary_match' }, { winnerId: 'different', manualOutcome: 'different_selected_idea' }] }, [70]);
      expect(result.sweep[0].original).toMatchObject({ denominator: 3, sourceQualifiedRows: 2, clearCoreIdeaMatches: 1, differentIdeas: 1, clearCoreIdeaRecall: 1 / 3, verified80PercentReached: false });
      expect(result.modelCalls).toBe(0); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it('never promotes an unreviewed idea or an unsupported quote when lowering a diagnostic score threshold', () => {
    const result = evaluateQualificationCache({ status: 'completed', runId: 'run', model: 'saved', prompt_version: 'v15', candidates: [source('rejected', 55), source('fabricated', 95, false)] }, { completedReplay: true, replaySha256: 'hash', rows: [row('r', 'rejected'), row('q', 'fabricated')] }, { rows: [{ winnerId: 'r', manualOutcome: 'rejected' }] }, [55, 70]);
    expect(result.sweep[0].original).toMatchObject({ sourceQualifiedRows: 1, clearCoreIdeaMatches: 0, newlyPassingNeedsIdeaReview: 1 });
    expect(result.sweep[1].original.sourceQualifiedRows).toBe(0);
    expect(result.sweep[0].diagnosticOnly).toBe(true);
  });
  it('refuses partial outcomes, duplicate identities and a benchmark from another corpus', () => {
    const replay = { status: 'completed', runId: 'run', model: 'saved', prompt_version: 'v15', candidates: [source('article')] };
    const benchmark = { completedReplay: true, replaySha256: 'hash', rows: [row('a', 'unknown')] };
    expect(() => evaluateQualificationCache(replay, benchmark, { rows: [] })).toThrow('different replay');
    expect(() => evaluateQualificationCache({ ...replay, status: 'failed' }, benchmark, { rows: [] })).toThrow();
    expect(() => evaluateQualificationCache({ ...replay, candidates: [source('article'), source('article')] }, benchmark, { rows: [] })).toThrow('Duplicate');
  });
});
