import { describe, expect, it } from 'vitest';
import { priceResearchUsage } from './research-pricing';

describe('research cost estimates', () => {
  it('prices ordinary input, cache reads and mixed write lifetimes exactly once', () => {
    const cost = priceResearchUsage('gpt-6-luna', 'default', {
      input_tokens: 12000, output_tokens: 1000,
      input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } },
    });
    expect(cost.costNanoUsd).toBe(2015000);
    expect(cost.costStatus).toBe('calculated');
    expect(JSON.parse(cost.rateCard!)).toMatchObject({ input: 0.1, write12h: 0.25, asOf: '2026-10-23' });
  });
  it('flags missing cache details as an estimate and unknown prices or usage as unknown', () => {
    expect(priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 2620, output_tokens: 12 })).toMatchObject({ costNanoUsd: 333500, costStatus: 'estimated' });
    for (const value of [
      priceResearchUsage('another-model', 'default', { input_tokens: 10, output_tokens: 5 }),
      priceResearchUsage('gpt-6-luna', 'unrecognized', { input_tokens: 10, output_tokens: 5 }),
      priceResearchUsage('gpt-6-luna', 'default'),
      priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 11, cache_write_tokens: 0 } }),
    ]) expect(value).toMatchObject({ costNanoUsd: null, costStatus: 'unknown' });
  });
  it('applies returned processing tier and long-context pricing', () => {
    const usage = { input_tokens: 300000, output_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
    expect(priceResearchUsage('gpt-6-luna-2026-10-01', 'default', usage).costNanoUsd).toBe(60750000);
    expect(priceResearchUsage('gpt-6-luna', 'priority', usage).costNanoUsd).toBe(121500000);
    expect(priceResearchUsage('gpt-6-luna', 'flex', usage).costNanoUsd).toBe(30375000);
    expect(priceResearchUsage('gpt-6-luna', 'default', { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } })).toMatchObject({ costNanoUsd: 0, costStatus: 'calculated' });
  });
});
