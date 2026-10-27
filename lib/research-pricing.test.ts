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

describe('Anthropic research cost estimates', () => {
  it('adds uncached input, cache reads and cache writes without double counting', () => {
    const cost = priceResearchUsage('claude-haiku-5-5', 'standard', {
      input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 4000, cache_creation_input_tokens: 7000,
      cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 4000 },
    });
    expect(cost).toMatchObject({ input: 12000, output: 500, cached: 4000, writes: 7000, costNanoUsd: 1565000, costStatus: 'calculated' });
    expect(JSON.parse(cost.rateCard!)).toMatchObject({ input: 0.1, write1h: 0.2, asOf: '2026-10-27' });
  });

  it('applies long-context rates only above 100k total input including caches', () => {
    const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 99000 };
    expect(priceResearchUsage('claude-haiku-5-5', 'default', usage)).toMatchObject({ input: 100000, costNanoUsd: 1140000 });
    expect(priceResearchUsage('claude-haiku-5-5-20261001', 'standard', { ...usage, cache_read_input_tokens: 99001 }))
      .toMatchObject({ input: 100001, costNanoUsd: 5700050 });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', {
      input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 100000,
      cache_creation: { ephemeral_5m_input_tokens: 40000, ephemeral_1h_input_tokens: 60000 },
    })).toMatchObject({ input: 101000, costNanoUsd: 85750000, costStatus: 'calculated' });
  });

  it('prices omitted caches as zero and flags cache writes with unknown lifetime as estimates', () => {
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20 }))
      .toMatchObject({ input: 100, cached: 0, writes: 0, costNanoUsd: 20000, costStatus: 'calculated' });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000 }))
      .toMatchObject({ input: 1100, costNanoUsd: 145000, costStatus: 'estimated' });
    expect(priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 0, output_tokens: 0 }))
      .toMatchObject({ costNanoUsd: 0, costStatus: 'calculated' });
  });

  it('rejects unsupported tiers and incomplete or invalid usage', () => {
    for (const value of [
      priceResearchUsage('claude-haiku-5-5', 'priority', { input_tokens: 100, output_tokens: 20 }),
      priceResearchUsage('claude-haiku-5-5', 'standard'),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100 }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: -1 }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 100 } }),
      priceResearchUsage('claude-haiku-5-5', 'standard', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 20, cache_read_input_tokens: 1 }),
    ]) expect(value).toMatchObject({ costNanoUsd: null, costStatus: 'unknown' });
  });
});
