export class ResearchCacheOnlyMiss extends Error {
  constructor(public readonly stage: string) {
    super(`Cached-only replay has no reusable ${stage} result; provider inference is disabled.`);
    this.name = 'ResearchCacheOnlyMiss';
  }
}
