import { z } from 'zod';

const candidate = z.object({
  id: z.string(), score: z.number().nullable(), grounded: z.boolean().nullable(),
  assessment: z.object({ chosenProfileId: z.string().nullable().optional(), profileFit: z.string().optional(), familyKey: z.string() }).passthrough().nullable(),
}).passthrough();
const replaySchema = z.object({ status: z.literal('completed'), runId: z.string(), model: z.string(), prompt_version: z.string(), candidates: z.array(candidate) }).passthrough();
const benchmarkSchema = z.object({ completedReplay: z.literal(true), replaySha256: z.string(), rows: z.array(z.object({
  winnerId: z.string(), population: z.string(), exactOriginUrl: z.string().nullable(),
  exactCandidateMatches: z.array(z.object({ itemId: z.string() }).passthrough()),
  exactExclusions: z.array(z.unknown()),
}).passthrough()) }).passthrough();
const ideasSchema = z.object({ rows: z.array(z.object({ winnerId: z.string(), manualOutcome: z.string() }).passthrough()) }).passthrough();

/** Only recalculates policy diagnostics from existing grades; never invokes a model. */
export function evaluateQualificationCache(replayValue: unknown, benchmarkValue: unknown, ideasValue: unknown, thresholds = [55, 60, 65, 70, 75, 80]) {
  const replay = replaySchema.parse(replayValue), benchmark = benchmarkSchema.parse(benchmarkValue), ideas = ideasSchema.parse(ideasValue);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(replay.candidates.map(x => x.id)) || !unique(benchmark.rows.map(x => x.winnerId)) || !unique(ideas.rows.map(x => x.winnerId))) throw new Error('Duplicate input identities');
  if (!thresholds.length || thresholds.some(x => !Number.isInteger(x) || x < 0 || x > 100)) throw new Error('Thresholds must be integers from0to100');
  const candidates = new Map(replay.candidates.map(x => [x.id, x])), manual = new Map(ideas.rows.map(x => [x.winnerId, x.manualOutcome]));
  for (const row of benchmark.rows) for (const match of row.exactCandidateMatches) if (!candidates.has(match.itemId)) throw new Error('Benchmark references a different replay corpus');
  const passes = (id: string, threshold: number) => {
    const c = candidates.get(id)!;
    return c.score !== null && c.score >= threshold && c.grounded === true && !!c.assessment?.chosenProfileId && !!c.assessment.profileFit?.trim() && (c.assessment.familyKey?.length || 0) >= 3;
  };
  function metrics(rows: typeof benchmark.rows, threshold: number) {
    const passing = rows.filter(r => r.exactCandidateMatches.some(x => passes(x.itemId, threshold)));
    const clear = passing.filter(r => manual.get(r.winnerId) === 'clear_central_summary_match').length;
    const partial = passing.filter(r => manual.get(r.winnerId) === 'partial_related_narrower_decision').length;
    const different = passing.filter(r => manual.get(r.winnerId) === 'different_selected_idea').length;
    return {
      denominator: rows.length, knownExactOriginRows: rows.filter(r => r.exactOriginUrl).length,
      eligibleExactSourceRows: rows.filter(r => r.exactCandidateMatches.length).length,
      sourceQualifiedRows: passing.length, sourceOverlap: rows.length ? passing.length / rows.length : null,
      clearCoreIdeaMatches: clear, clearCoreIdeaRecall: rows.length ? clear / rows.length : null,
      partialRelated: partial, differentIdeas: different, newlyPassingNeedsIdeaReview: passing.length - clear - partial - different,
      minimumFor80Percent: Math.ceil(rows.length * 0.8), minimumFor90Percent: Math.ceil(rows.length * 0.9),
      verified80PercentReached: rows.length > 0 && clear / rows.length >= 0.8,
    };
  }
  return {
    mode: 'cached_qualification_diagnostics_only', modelCalls: 0, writingCalls: 0, networkCalls: 0,
    gradedRunId: replay.runId, gradedModel: replay.model, gradedPromptVersion: replay.prompt_version,
    originalPopulation: benchmark.rows.filter(r => r.population === 'baseline').length,
    fullPopulation: benchmark.rows.length,
    sweep: [...new Set(thresholds)].map(threshold => ({ threshold, diagnosticOnly: threshold !== 70,
      sourceFindings: replay.candidates.filter(c => passes(c.id, threshold)).length,
      original: metrics(benchmark.rows.filter(r => r.population === 'baseline'), threshold), all: metrics(benchmark.rows, threshold),
    })),
    limits: [
      'Cached grades do not evaluate a changed prompt, model, audience, source text or selected idea.',
      'Threshold changes cannot find missing sources or select another angle. New passing ideas need human review.',
      'Source-URL overlap is separate from clear core-idea recall. All benchmark rows remain in each denominator.',
      'This diagnostic does not estimate precision; labeled negative controls are a separate development test.',
      'A threshold below70 is sensitivity analysis only and does not change production policy.',
    ],
  };
}
